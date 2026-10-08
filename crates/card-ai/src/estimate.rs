//! What a run will cost, worked out from the requests themselves before anything is sent. Tokens are
//! approximate (a picture costs about width x height / 750, text about a quarter of its characters);
//! dollars are shown only for a model whose list price is known here.

use crate::provider::{AiRequest, ProviderConfig};
use serde::{Deserialize, Serialize};

/// List prices in US dollars per million input and output tokens, as of 2026-10: approximate.
const PRICES: &[(&str, f64, f64)] = &[("claude-sonnet-5-5", 3.0, 15.0)];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Estimate {
    pub requests: usize,
    pub images: usize,
    pub input_tokens: u64,
    pub output_tokens: u64,
    /// The server the requests go to.
    pub host: String,
    /// Whether any picture is sent (false = text only).
    pub sends_images: bool,
    /// Approximate cost, only for models with a known price.
    pub cost_usd: Option<f64>,
}

fn image_tokens(width: u32, height: u32) -> u64 {
    (u64::from(width) * u64::from(height)).div_ceil(750)
}

pub fn price_for(model: &str) -> Option<(f64, f64)> {
    PRICES
        .iter()
        .find(|(m, _, _)| model.starts_with(m))
        .map(|(_, i, o)| (*i, *o))
}

pub fn estimate(requests: &[AiRequest], config: &ProviderConfig) -> Estimate {
    let mut input = 0u64;
    let mut output = 0u64;
    let mut images = 0usize;
    for r in requests {
        images += r.images.len();
        input += r
            .images
            .iter()
            .map(|i| image_tokens(i.width, i.height))
            .sum::<u64>();
        input += (r.instruction.len() as u64 + r.schema.to_string().len() as u64).div_ceil(4);
        // Answers are short: about half of what is allowed.
        output += u64::from(r.max_output_tokens) / 2;
    }
    let cost_usd =
        price_for(&config.model).map(|(i, o)| (input as f64 * i + output as f64 * o) / 1_000_000.0);
    Estimate {
        requests: requests.len(),
        images,
        input_tokens: input,
        output_tokens: output,
        host: config.host(),
        sends_images: images > 0,
        cost_usd,
    }
}
