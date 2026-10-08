//! Core engine for the PDF card editor.
//!
//! Deliberately independent of Tauri/React: the UI preview and the PDF
//! exporter both consume [`layout::calculate_layout`], the single source of
//! truth for geometry.

pub mod card;
pub mod error;
pub mod export;
pub mod finish;
pub mod geometry;
pub mod layout;
pub mod project;
pub mod render;
pub mod render_worker;
pub mod sample;
pub mod sheet;
pub mod units;

pub use error::{Error, ErrorInfo, ErrorParam, Result};
