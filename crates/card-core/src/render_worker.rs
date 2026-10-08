//! A dedicated thread that owns pdfium and the open documents.
//!
//! `PdfDocument` borrows `Pdfium`, so neither can live in shared app state. Instead the
//! thread owns both and callers send requests over a channel, which also serialises all
//! pdfium use. A document is parsed once per [`RenderWorker::open`], not per render, and a
//! project can keep several open, each under its [`DocumentId`].
//!
//! Requests carry `(kind, generation)`. Before drawing, the thread drops a viewport or
//! magnifier request that a newer one of the same kind has superseded; the caller gets
//! [`Error::Superseded`]. Thumbnails and page layers are never dropped (each is a different
//! page or pane), but thumbnails run last so they never delay the interactive kinds.

use crate::card::DocumentId;
use crate::detect::{default_engines, detect_page, read::read_page_data, Detection};
use crate::error::{Error, Result};
use crate::geometry::Rect;
use crate::render::{
    bind_pdfium, document_info_in, render_page_png_in, render_region_png_in, DocumentInfo,
};
use pdfium_render::prelude::{PdfDocument, Pdfium};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RenderKind {
    /// Sharp crop of the visible part of the main view. Superseded by newer viewport requests.
    Viewport,
    /// Crop under the magnifier. Superseded by newer magnifier requests.
    Magnifier,
    /// Sidebar thumbnail. Never dropped; lowest priority.
    Thumbnail,
    /// Whole-page base layer of a preview pane. Never dropped.
    Page,
}

impl RenderKind {
    const COUNT: usize = 4;

    fn index(self) -> usize {
        self as usize
    }

    fn supersedable(self) -> bool {
        matches!(self, RenderKind::Viewport | RenderKind::Magnifier)
    }
}

type Reply<T> = Sender<Result<T>>;

enum Work {
    Open(DocumentId, PathBuf, Reply<DocumentInfo>),
    /// Close one document, or every document when the id is `None`.
    Close(Option<DocumentId>, Reply<()>),
    Page(DocumentId, usize, u32, Reply<Vec<u8>>),
    Region(DocumentId, usize, Rect, u32, Reply<Vec<u8>>),
    Detect(DocumentId, usize, Reply<Detection>),
}

struct Msg {
    kind: RenderKind,
    generation: u64,
    work: Work,
}

impl Msg {
    /// Lower runs first.
    fn priority(&self) -> u8 {
        match (&self.work, self.kind) {
            (Work::Open(..) | Work::Close(..), _) => 0,
            (_, RenderKind::Thumbnail) => 2,
            _ => 1,
        }
    }
}

pub struct RenderWorker {
    tx: Sender<Msg>,
    latest: Arc<[AtomicU64; RenderKind::COUNT]>,
}

impl RenderWorker {
    /// Start the thread and bind pdfium on it. Fails if the library cannot be loaded.
    pub fn spawn(lib_dirs: Vec<PathBuf>) -> Result<Self> {
        let (tx, rx) = channel::<Msg>();
        let (ready_tx, ready_rx) = channel::<Result<()>>();
        let latest: Arc<[AtomicU64; RenderKind::COUNT]> =
            Arc::new(std::array::from_fn(|_| AtomicU64::new(0)));
        let thread_latest = latest.clone();
        std::thread::Builder::new()
            .name("pdfium-render".into())
            .spawn(move || match bind_pdfium(&lib_dirs) {
                Ok(pdfium) => {
                    let _ = ready_tx.send(Ok(()));
                    run(&pdfium, &rx, &*thread_latest);
                }
                Err(e) => {
                    let _ = ready_tx.send(Err(e));
                }
            })?;
        ready_rx.recv().map_err(|_| Error::WorkerStopped)??;
        Ok(Self { tx, latest })
    }

    fn send<T>(&self, kind: RenderKind, work: impl FnOnce(Reply<T>) -> Work) -> Result<T> {
        let generation = self.latest[kind.index()].fetch_add(1, Ordering::SeqCst) + 1;
        let (reply, rx) = channel();
        self.tx
            .send(Msg {
                kind,
                generation,
                work: work(reply),
            })
            .map_err(|_| Error::WorkerStopped)?;
        rx.recv().map_err(|_| Error::WorkerStopped)?
    }

    /// Parse `path` once and keep it open under `document_id` for later renders (replacing
    /// whatever was open under that id). Blocks until done.
    pub fn open(&self, document_id: DocumentId, path: PathBuf) -> Result<DocumentInfo> {
        self.send(RenderKind::Page, |r| Work::Open(document_id, path, r))
    }

    /// Forget one open document, or all of them (`None`). Blocks until done.
    pub fn close(&self, document_id: Option<DocumentId>) -> Result<()> {
        self.send(RenderKind::Page, |r| Work::Close(document_id, r))
    }

    /// Blocks until rendered (or superseded).
    pub fn render_page(
        &self,
        kind: RenderKind,
        document_id: DocumentId,
        page_index: usize,
        width_px: u32,
    ) -> Result<Vec<u8>> {
        self.send(kind, |r| Work::Page(document_id, page_index, width_px, r))
    }

    /// Where the pieces seem to be on a page, found locally (see [`crate::detect`]). Blocks until done.
    pub fn detect(&self, document_id: DocumentId, page_index: usize) -> Result<Detection> {
        self.send(RenderKind::Page, |r| {
            Work::Detect(document_id, page_index, r)
        })
    }

    /// Blocks until rendered (or superseded).
    pub fn render_region(
        &self,
        kind: RenderKind,
        document_id: DocumentId,
        page_index: usize,
        region: Rect,
        full_width_px: u32,
    ) -> Result<Vec<u8>> {
        self.send(kind, |r| {
            Work::Region(document_id, page_index, region, full_width_px, r)
        })
    }
}

fn run(pdfium: &Pdfium, rx: &Receiver<Msg>, latest: &[AtomicU64]) {
    let mut docs: HashMap<DocumentId, PdfDocument> = HashMap::new();
    let mut queue: VecDeque<Msg> = VecDeque::new();
    loop {
        if queue.is_empty() {
            match rx.recv() {
                Ok(m) => queue.push_back(m),
                Err(_) => return,
            }
        }
        queue.extend(rx.try_iter());
        let next = queue
            .iter()
            .enumerate()
            .min_by_key(|(i, m)| (m.priority(), *i))
            .map(|(i, _)| i)
            .unwrap_or(0);
        let Some(msg) = queue.remove(next) else {
            continue;
        };
        let stale = msg.kind.supersedable()
            && msg.generation < latest[msg.kind.index()].load(Ordering::SeqCst);
        match msg.work {
            Work::Open(id, path, reply) => {
                let result = pdfium
                    .load_pdf_from_file(&path, None)
                    .map_err(|e| Error::Pdfium(e.to_string()))
                    .and_then(|d| {
                        let info = document_info_in(&d)?;
                        docs.insert(id, d);
                        Ok(info)
                    });
                let _ = reply.send(result);
            }
            Work::Close(id, reply) => {
                match id {
                    Some(id) => {
                        docs.remove(&id);
                    }
                    None => docs.clear(),
                }
                let _ = reply.send(Ok(()));
            }
            Work::Page(id, index, width, reply) => {
                let _ = reply.send(if stale {
                    Err(Error::Superseded)
                } else {
                    docs.get(&id)
                        .ok_or(Error::NoDocument)
                        .and_then(|d| render_page_png_in(d, index, width))
                });
            }
            Work::Detect(id, index, reply) => {
                let _ = reply.send(
                    docs.get(&id)
                        .ok_or(Error::NoDocument)
                        .and_then(|d| read_page_data(d, index))
                        .map(|data| detect_page(&data, &default_engines())),
                );
            }
            Work::Region(id, index, region, width, reply) => {
                let _ = reply.send(if stale {
                    Err(Error::Superseded)
                } else {
                    docs.get(&id)
                        .ok_or(Error::NoDocument)
                        .and_then(|d| render_region_png_in(d, index, region, width))
                });
            }
        }
    }
}
