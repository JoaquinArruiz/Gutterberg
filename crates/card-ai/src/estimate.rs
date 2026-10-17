//! What a run will send, worked out from the requests themselves before anything is sent. Tokens are
//! approximate (a picture costs about width x height / 750, text about a quarter of its characters). No price
//! is worked out: list prices change, and an app that is not updated would show a wrong one.

use crate::provider::{AiRequest, ProviderConfig};
use serde::{Deserialize, Serialize};

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
}

fn image_tokens(width: u32, height: u32) -> u64 {
    (u64::from(width) * u64::from(height)).div_ceil(750)
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
    Estimate {
        requests: requests.len(),
        images,
        input_tokens: input,
        output_tokens: output,
        host: config.host(),
        sends_images: images > 0,
    }
}
