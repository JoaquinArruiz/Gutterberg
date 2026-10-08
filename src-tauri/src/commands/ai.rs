//! The AI Mode commands (M19): thin wrappers that gather what a request needs from the render worker and
//! hand it to `card_ai::Runner`. Every one refuses while AI Mode is off, before any key is read or any
//! request is made; none returns a key.

use crate::state::{internal, AppState};
use card_ai::estimate::{estimate, Estimate};
use card_ai::sort::{sort_requests, PageLabel, PageSummary, SortInput};
use card_ai::tasks::detect_request;
use card_ai::{
    AiError, Image, KeyStore, ProviderConfig, ProviderKind, Runner, UreqTransport, Usage,
};
use card_core::card::DocumentId;
use card_core::detect::Detection;
use card_core::units::pt_to_mm;
use card_core::ErrorInfo;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

/// Long side of the page picture sent for Detect, and of each thumbnail sent for Sort pages.
const DETECT_LONG_SIDE_PX: u32 = 1000;
const SORT_LONG_SIDE_PX: u32 = 320;
/// A provider's limit on one picture is about 5 MB; stay under it.
const MAX_IMAGE_BYTES: usize = 4_500_000;

fn to_info(e: AiError) -> ErrorInfo {
    e.into()
}

/// Turns AI Mode on or off for this session. The interface sends it when the preference changes and at start-up.
#[tauri::command]
pub fn ai_set_enabled(state: State<'_, AppState>, enabled: bool) {
    state.ai_gate.set(enabled);
}

/// Whether a key is saved for `provider`. Never the key itself.
#[tauri::command]
pub fn ai_key_status(
    state: State<'_, AppState>,
    provider: ProviderKind,
) -> Result<bool, ErrorInfo> {
    state.ai_gate.check().map_err(to_info)?;
    state.ai_keys.has(provider).map_err(to_info)
}

/// Saves the key in the system keychain, replacing any. The field the user typed it in is then cleared.
#[tauri::command]
pub fn ai_set_key(
    state: State<'_, AppState>,
    provider: ProviderKind,
    key: String,
) -> Result<(), ErrorInfo> {
    state.ai_gate.check().map_err(to_info)?;
    let key = key.trim();
    if key.is_empty() {
        return Err(to_info(AiError::Config("the key is empty".into())));
    }
    state.ai_keys.set(provider, key).map_err(to_info)
}

/// Removes the saved key. Allowed while AI Mode is off, so a key can always be taken back out.
#[tauri::command]
pub fn ai_delete_key(state: State<'_, AppState>, provider: ProviderKind) -> Result<(), ErrorInfo> {
    state.ai_keys.delete(provider).map_err(to_info)
}

/// One tiny text request: do the address, the model and the key work?
#[tauri::command]
pub async fn ai_test_connection(
    state: State<'_, AppState>,
    config: ProviderConfig,
) -> Result<Usage, ErrorInfo> {
    let (gate, keys) = (state.ai_gate.clone(), state.ai_keys.clone());
    tauri::async_runtime::spawn_blocking(move || {
        Runner {
            gate: &gate,
            config: &config,
            keys: &*keys,
            transport: &UreqTransport,
        }
        .test()
        .map_err(to_info)
    })
    .await
    .map_err(internal)?
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Task {
    Detect,
    Sort,
}

/// The picture (or, text only, the boxes) a Detect request needs for one page.
fn detect_inputs(
    state: &AppState,
    app: &AppHandle,
    document: DocumentId,
    page: usize,
    send_images: bool,
) -> Result<
    (
        card_core::geometry::PageSize,
        Option<Image>,
        Vec<card_core::detect::PageObject>,
    ),
    ErrorInfo,
> {
    let worker = state.worker(app)?;
    let (size, objects) = worker.page_objects(document, page)?;
    if !send_images {
        return Ok((size, None, objects));
    }
    let rendered = worker
        .render_fit(document, vec![page], DETECT_LONG_SIDE_PX, MAX_IMAGE_BYTES)?
        .remove(0);
    let image = Image {
        mime: "image/png".into(),
        bytes: rendered.png,
        width: rendered.width,
        height: rendered.height,
    };
    Ok((size, Some(image), Vec::new()))
}

/// The thumbnails (or, text only, the descriptions) of `pages` for Sort pages.
fn sort_input(
    state: &AppState,
    app: &AppHandle,
    document: DocumentId,
    pages: Vec<usize>,
    send_images: bool,
) -> Result<SortInput, ErrorInfo> {
    let worker = state.worker(app)?;
    if send_images {
        let rendered =
            worker.render_fit(document, pages.clone(), SORT_LONG_SIDE_PX, MAX_IMAGE_BYTES)?;
        let images = pages
            .into_iter()
            .zip(rendered)
            .map(|(i, r)| {
                (
                    i,
                    Image {
                        mime: "image/png".into(),
                        bytes: r.png,
                        width: r.width,
                        height: r.height,
                    },
                )
            })
            .collect();
        return Ok(SortInput::Images(images));
    }
    let summaries = worker.page_summaries(document, pages)?;
    Ok(SortInput::Text(
        summaries
            .into_iter()
            .map(|s| PageSummary {
                page_index: s.page_index,
                width_mm: pt_to_mm(s.size.width_pt),
                height_mm: pt_to_mm(s.size.height_pt),
                images: s.images,
                paths: s.paths,
                texts: s.texts,
                text: s.text,
            })
            .collect(),
    ))
}

/// What a run would send and cost, worked out from the very requests it would make, before anything is sent.
#[tauri::command]
pub async fn ai_estimate(
    app: AppHandle,
    state: State<'_, AppState>,
    task: Task,
    document_id: DocumentId,
    pages: Vec<usize>,
    config: ProviderConfig,
    send_images: bool,
) -> Result<Estimate, ErrorInfo> {
    state.ai_gate.check().map_err(to_info)?;
    tauri::async_runtime::spawn_blocking(move || {
        let shared = app.state::<AppState>();
        let requests = match task {
            Task::Detect => {
                let page = *pages
                    .first()
                    .ok_or_else(|| to_info(AiError::Config("no page".into())))?;
                let (size, image, objects) =
                    detect_inputs(&shared, &app, document_id, page, send_images)?;
                vec![detect_request(size, image, &objects).map_err(to_info)?]
            }
            Task::Sort => {
                sort_requests(sort_input(&shared, &app, document_id, pages, send_images)?)
                    .into_iter()
                    .map(|(r, _)| r)
                    .collect()
            }
        };
        Ok(estimate(&requests, &config))
    })
    .await
    .map_err(internal)?
}

#[derive(Serialize)]
pub struct AiDetection {
    pub detection: Detection,
    pub usage: Usage,
}

/// Detect pieces on one page with the AI engine. The answer is a proposal; nothing is applied.
#[tauri::command]
pub async fn ai_detect_pieces(
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: DocumentId,
    page_index: usize,
    config: ProviderConfig,
    send_images: bool,
) -> Result<AiDetection, ErrorInfo> {
    state.ai_gate.check().map_err(to_info)?;
    tauri::async_runtime::spawn_blocking(move || {
        let shared = app.state::<AppState>();
        let (size, image, objects) =
            detect_inputs(&shared, &app, document_id, page_index, send_images)?;
        let runner = Runner {
            gate: &shared.ai_gate,
            config: &config,
            keys: &*shared.ai_keys,
            transport: &UreqTransport,
        };
        let (detection, usage) = runner.detect(size, image, &objects).map_err(to_info)?;
        Ok(AiDetection { detection, usage })
    })
    .await
    .map_err(internal)?
}

#[derive(Serialize)]
pub struct AiSort {
    pub labels: Vec<PageLabel>,
    pub usage: Usage,
}

/// Labels `pages` of a PDF (cards, backs, rules, cover, other). The answer is a proposal; nothing is applied.
#[tauri::command]
pub async fn ai_sort_pages(
    app: AppHandle,
    state: State<'_, AppState>,
    document_id: DocumentId,
    pages: Vec<usize>,
    config: ProviderConfig,
    send_images: bool,
) -> Result<AiSort, ErrorInfo> {
    state.ai_gate.check().map_err(to_info)?;
    tauri::async_runtime::spawn_blocking(move || {
        let shared = app.state::<AppState>();
        let input = sort_input(&shared, &app, document_id, pages, send_images)?;
        let runner = Runner {
            gate: &shared.ai_gate,
            config: &config,
            keys: &*shared.ai_keys,
            transport: &UreqTransport,
        };
        let (labels, usage) = runner.sort(input).map_err(to_info)?;
        Ok(AiSort { labels, usage })
    })
    .await
    .map_err(internal)?
}
