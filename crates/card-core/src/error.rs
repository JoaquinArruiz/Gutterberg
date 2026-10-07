use thiserror::Error;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Error)]
pub enum Error {
    #[error("PDF error: {0}")]
    Pdf(#[from] lopdf::Error),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid grid: {0}")]
    InvalidGrid(String),
    #[error("page {0} does not exist (document has {1} pages)")]
    PageOutOfRange(usize, usize),
    #[error("page {0} has a /Rotate of {1}; rotated pages are not supported yet")]
    UnsupportedRotation(usize, i64),
    #[error(
        "laid-out cards need {needed_w_mm:.1} x {needed_h_mm:.1} mm but the output page is only \
         {page_w_mm:.1} x {page_h_mm:.1} mm"
    )]
    DoesNotFit {
        needed_w_mm: f64,
        needed_h_mm: f64,
        page_w_mm: f64,
        page_h_mm: f64,
    },
    #[error("pdfium error: {0}")]
    Pdfium(String),
    #[error("superseded")]
    Superseded,
    #[error("render thread stopped")]
    WorkerStopped,
    #[error("no PDF is open")]
    NoDocument,
    #[error("malformed PDF: {0}")]
    Malformed(String),
}
