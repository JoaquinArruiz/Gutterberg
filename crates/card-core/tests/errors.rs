//! Errors reach the UI as a stable code plus values; the English text stays as the fallback.
use card_core::export::{validate_export, PageJob};
use card_core::sample::{sample_grid, sample_pdf_pages};
use card_core::{Error, ErrorInfo};
use serde_json::Value;

fn as_json(e: &Error) -> Value {
    serde_json::to_value(e).unwrap()
}

#[test]
fn does_not_fit_carries_its_sizes() {
    let e = Error::DoesNotFit {
        needed_w_mm: 210.5,
        needed_h_mm: 297.0,
        page_w_mm: 200.0,
        page_h_mm: 280.0,
    };
    let v = as_json(&e);
    assert_eq!(v["code"], "does_not_fit");
    assert_eq!(v["needed_w_mm"], 210.5);
    assert_eq!(v["page_h_mm"], 280.0);
    assert_eq!(v["message"], e.to_string());
}

#[test]
fn page_numbers_are_one_based() {
    let v = as_json(&Error::PageOutOfRange(4, 3));
    assert_eq!(v["code"], "page_out_of_range");
    assert_eq!(v["page"].as_f64(), Some(5.0));
    assert_eq!(v["count"].as_f64(), Some(3.0));
    let v = as_json(&Error::UnsupportedRotation(0, 45));
    assert_eq!(v["page"].as_f64(), Some(1.0));
    assert_eq!(v["rotate"].as_f64(), Some(45.0));
}

#[test]
fn errors_without_values_are_just_a_code() {
    for (e, code) in [
        (Error::Superseded, "superseded"),
        (Error::NoDocument, "no_document"),
        (Error::WorkerStopped, "worker_stopped"),
    ] {
        let v = as_json(&e);
        assert_eq!(v["code"], code);
        assert_eq!(v.as_object().unwrap().len(), 2, "{v}");
    }
}

#[test]
fn text_details_pass_through_for_the_generic_codes() {
    let v = as_json(&Error::Malformed("page 2 has no MediaBox".into()));
    assert_eq!(v["code"], "malformed");
    assert_eq!(v["detail"], "page 2 has no MediaBox");
}

#[test]
fn error_info_round_trips() {
    let info = ErrorInfo::from(Error::PageOutOfRange(1, 1));
    let back: ErrorInfo = serde_json::from_value(serde_json::to_value(&info).unwrap()).unwrap();
    assert_eq!(back, info);
}

#[test]
fn page_issues_carry_the_code_and_values() {
    let doc = sample_pdf_pages(2);
    let issues = validate_export(
        &doc,
        &[PageJob {
            page_index: 1,
            grid: sample_grid(20.0), // does not fit
        }],
    );
    let v = serde_json::to_value(&issues[0]).unwrap();
    assert_eq!(v["page_index"].as_u64(), Some(1));
    assert_eq!(v["code"], "does_not_fit");
    assert!(v["needed_w_mm"].is_number(), "{v}");
    assert!(v["message"].as_str().unwrap().contains("mm"));
}
