//! The switch behind AI Mode. The UI sets it when the preference changes (and at start-up); every request
//! goes through [`guarded_send`], which refuses while it is off, before anything touches the network.

use crate::error::{AiError, Result};
use crate::provider::{send, AiReply, AiRequest, ProviderConfig, Transport};
use std::sync::atomic::{AtomicBool, Ordering};

/// Off until the user turns AI Mode on.
#[derive(Debug, Default)]
pub struct Gate(AtomicBool);

impl Gate {
    pub fn set(&self, on: bool) {
        self.0.store(on, Ordering::SeqCst);
    }

    pub fn is_on(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }

    pub fn check(&self) -> Result<()> {
        if self.is_on() {
            Ok(())
        } else {
            Err(AiError::Disabled)
        }
    }
}

/// [`send`], unless AI Mode is off.
pub fn guarded_send(
    gate: &Gate,
    config: &ProviderConfig,
    key: Option<&str>,
    request: &AiRequest,
    transport: &dyn Transport,
) -> Result<AiReply> {
    gate.check()?;
    send(config, key, request, transport)
}
