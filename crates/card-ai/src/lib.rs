//! Optional AI-assisted detection and page sorting.
//!
//! This is the only crate that talks to the network, and it only does so when a command asks it to
//! (the shell refuses every request while AI Mode is off). One request is an instruction, some
//! images and a JSON Schema; the reply is validated here into a `card_core::detect::Proposal` or
//! page labels, and the project is never touched.

pub mod adapters;
pub mod error;
pub mod estimate;
pub mod gate;
pub mod keystore;
pub mod provider;
pub mod run;
pub mod sort;
pub mod tasks;
pub mod transport;

pub use error::{AiError, Result};
pub use gate::{guarded_send, Gate};
pub use keystore::{KeyStore, MemoryKeys};
pub use provider::{
    send, AiReply, AiRequest, HttpRequest, HttpResponse, Image, ProviderConfig, ProviderKind,
    Transport, Usage,
};
pub use run::Runner;
pub use transport::UreqTransport;
