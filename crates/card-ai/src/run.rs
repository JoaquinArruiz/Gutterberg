//! The actions, end to end, from what the shell has prepared (page size, pictures, boxes, thumbnails) to a
//! validated result and what it cost. Every step goes through the gate, so with AI Mode off nothing is
//! read from the keychain and nothing is sent.

use crate::error::{AiError, Result};
use crate::gate::{guarded_send, Gate};
use crate::keystore::KeyStore;
use crate::provider::{AiRequest, ProviderConfig, Transport, Usage};
use crate::sort::{parse_sort, sort_requests, PageLabel, SortInput};
use crate::tasks::{detect_request, parse_detect};
use card_core::detect::{Detection, PageObject};
use card_core::geometry::PageSize;
use serde_json::json;

pub struct Runner<'a> {
    pub gate: &'a Gate,
    pub config: &'a ProviderConfig,
    pub keys: &'a dyn KeyStore,
    pub transport: &'a dyn Transport,
}

impl Runner<'_> {
    /// The key to send, read now and held only for the request. Ollama has none.
    fn key(&self) -> Result<Option<String>> {
        self.gate.check()?;
        if !self.config.kind.needs_key() {
            return Ok(None);
        }
        self.keys
            .get(self.config.kind)?
            .map(Some)
            .ok_or(AiError::NoKey)
    }

    fn send(&self, key: Option<&str>, request: &AiRequest) -> Result<crate::provider::AiReply> {
        guarded_send(self.gate, self.config, key, request, self.transport)
    }

    /// A tiny text request, to see that the address, the model and the key work.
    pub fn test(&self) -> Result<Usage> {
        let key = self.key()?;
        let request = AiRequest {
            instruction: "Answer with ok set to true.".into(),
            images: Vec::new(),
            schema: json!({
                "type": "object",
                "additionalProperties": false,
                "properties": { "ok": { "type": "boolean" } },
                "required": ["ok"],
            }),
            max_output_tokens: 64,
        };
        let reply = self.send(key.as_deref(), &request)?;
        if reply.json.get("ok").is_none() {
            return Err(AiError::InvalidReply(
                "the answer does not have the shape asked for".into(),
            ));
        }
        Ok(reply.usage)
    }

    /// Detect pieces on one page: with a picture, or (`image` is None) from the boxes of its objects.
    pub fn detect(
        &self,
        page: PageSize,
        image: Option<crate::provider::Image>,
        objects: &[PageObject],
    ) -> Result<(Detection, Usage)> {
        self.gate.check()?;
        // Built first, so a page that cannot be described fails before the keychain is read.
        let request = detect_request(page, image, objects)?;
        let key = self.key()?;
        let reply = self.send(key.as_deref(), &request)?;
        Ok((parse_detect(&reply.json, page)?, reply.usage))
    }

    /// Labels every page of `input`, one request per batch. Any failure fails the run: no partial labels.
    pub fn sort(&self, input: SortInput) -> Result<(Vec<PageLabel>, Usage)> {
        self.gate.check()?;
        let requests = sort_requests(input);
        let key = self.key()?;
        let mut labels = Vec::new();
        let mut usage = Usage::default();
        for (request, pages) in &requests {
            let reply = self.send(key.as_deref(), request)?;
            labels.extend(parse_sort(&reply.json, pages)?);
            usage.add(reply.usage);
        }
        labels.sort_by_key(|l| l.page_index);
        Ok((labels, usage))
    }
}
