//! The real network: one blocking POST (or GET, for the model list) with a timeout, no redirects (a redirect could carry the key to
//! another host), and error statuses handed back as answers for the adapters to read.

use crate::error::{AiError, Result};
use crate::provider::{HttpRequest, HttpResponse, Transport};
use std::time::Duration;

/// Largest answer read (a JSON reply is a few kilobytes; a picture from Fill with AI a few megabytes).
const MAX_RESPONSE_BYTES: u64 = 32 * 1024 * 1024;

pub struct UreqTransport;

fn agent(timeout: Duration) -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(timeout))
        .http_status_as_error(false)
        .max_redirects(0)
        .max_redirects_will_error(false)
        .build()
        .into()
}

fn read(mut response: ureq::http::Response<ureq::Body>) -> Result<HttpResponse> {
    let status = response.status().as_u16();
    let body = response
        .body_mut()
        .with_config()
        .limit(MAX_RESPONSE_BYTES)
        .read_to_vec()
        .map_err(map_error)?;
    Ok(HttpResponse { status, body })
}

impl Transport for UreqTransport {
    fn post(&self, request: &HttpRequest, timeout: Duration) -> Result<HttpResponse> {
        let mut call = agent(timeout).post(&request.url);
        for (name, value) in &request.headers {
            call = call.header(name.as_str(), value.as_str());
        }
        read(call.send(&request.body[..]).map_err(map_error)?)
    }

    fn get(&self, request: &HttpRequest, timeout: Duration) -> Result<HttpResponse> {
        let mut call = agent(timeout).get(&request.url);
        for (name, value) in &request.headers {
            call = call.header(name.as_str(), value.as_str());
        }
        read(call.call().map_err(map_error)?)
    }
}

fn map_error(e: ureq::Error) -> AiError {
    match e {
        ureq::Error::Timeout(_) => AiError::Timeout,
        other => AiError::Network(other.to_string()),
    }
}
