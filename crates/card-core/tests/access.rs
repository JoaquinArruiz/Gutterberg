//! PDF permission flags: a PDF locked against printing or modifying is refused, other restrictions travel to
//! the output, and a PDF without restrictions exports as before. The fixtures are made here by encrypting the
//! synthetic sample page, so there are no binary files to keep.
use card_core::access::{self, PdfAccess};
use card_core::card::DEFAULT_DOCUMENT_ID;
use card_core::error::Error;
use card_core::export::{export_pdf, plan_print_file, validate_export_file, ExportJob, PageJob};
use card_core::finish::Finishing;
use card_core::render::{bind_pdfium, document_info};
use card_core::sample::{sample_grid, sample_pdf};
use card_core::sheet::{PaginateOptions, PrintLayout};
use lopdf::encryption::crypt_filters::{Aes128CryptFilter, CryptFilter};
use lopdf::{Document, EncryptionState, EncryptionVersion, Object, Permissions, StringFormat};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;

/// Every flag PDF defines.
fn all() -> Permissions {
    Permissions::PRINTABLE
        | Permissions::MODIFIABLE
        | Permissions::COPYABLE
        | Permissions::ANNOTABLE
        | Permissions::FILLABLE
        | Permissions::COPYABLE_FOR_ACCESSIBILITY
        | Permissions::ASSEMBLABLE
        | Permissions::PRINTABLE_IN_HIGH_QUALITY
}

fn dir(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("card-core-access-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// The sample page, encrypted (no password to open it) with `permissions`; `None` leaves it plain.
fn source(dir: &std::path::Path, name: &str, permissions: Option<Permissions>) -> PathBuf {
    let mut doc = sample_pdf();
    if let Some(permissions) = permissions {
        // A real encrypted PDF always has the file identifier the key is made from.
        let id = Object::String(vec![7; 16], StringFormat::Hexadecimal);
        doc.trailer.set("ID", Object::Array(vec![id.clone(), id]));
        let filter: Arc<dyn CryptFilter> = Arc::new(Aes128CryptFilter);
        let version = EncryptionVersion::V4 {
            document: &doc,
            encrypt_metadata: true,
            crypt_filters: BTreeMap::from([(b"StdCF".to_vec(), filter)]),
            stream_filter: b"StdCF".to_vec(),
            string_filter: b"StdCF".to_vec(),
            owner_password: "publisher",
            user_password: "",
            permissions,
        };
        let state = EncryptionState::try_from(version).unwrap();
        doc.encrypt(&state).unwrap();
    }
    let path = dir.join(name);
    doc.save(&path).unwrap();
    path
}

fn job() -> ExportJob {
    ExportJob {
        pages: vec![PageJob {
            page_index: 0,
            grid: sample_grid(3.0),
        }],
    }
}

fn locked(e: Error) -> (u32, String) {
    match e {
        Error::PdfLocked {
            document_id,
            reason,
        } => (document_id, reason),
        other => panic!("expected PdfLocked, got {other}"),
    }
}

#[test]
fn a_pdf_locked_against_printing_is_refused_before_anything_is_written() {
    let d = dir("print");
    let input = source(&d, "in.pdf", Some(all() - Permissions::PRINTABLE));
    let out = d.join("out.pdf");
    assert_eq!(
        locked(validate_export_file(&input, &job().pages).unwrap_err()),
        (DEFAULT_DOCUMENT_ID, "printing".into())
    );
    assert_eq!(
        locked(export_pdf(&input, &out, &job()).unwrap_err()).1,
        "printing"
    );
    assert!(!out.exists(), "a refused export leaves no file");
}

#[test]
fn a_pdf_locked_against_modifying_is_refused() {
    let d = dir("modify");
    let input = source(&d, "in.pdf", Some(all() - Permissions::MODIFIABLE));
    let out = d.join("out.pdf");
    assert_eq!(
        locked(export_pdf(&input, &out, &job()).unwrap_err()).1,
        "modifying"
    );
    assert!(!out.exists());
}

#[test]
fn the_print_plan_is_refused_too() {
    let d = dir("plan");
    let input = source(&d, "in.pdf", Some(all() - Permissions::MODIFIABLE));
    let err = plan_print_file(
        &input,
        &[],
        &[],
        &PrintLayout::SameAsSource,
        &PaginateOptions::default(),
        &Finishing::default(),
    )
    .unwrap_err();
    assert_eq!(locked(err).1, "modifying");
}

#[test]
fn other_restrictions_export_and_the_output_carries_them() {
    let d = dir("copy");
    let input = source(&d, "in.pdf", Some(all() - Permissions::COPYABLE));
    let out = d.join("out.pdf");
    assert!(validate_export_file(&input, &job().pages)
        .unwrap()
        .is_empty());
    export_pdf(&input, &out, &job()).unwrap();

    let doc = Document::load(&out).unwrap();
    let flags = access::permissions_of(&doc).expect("the output keeps the source's restrictions");
    let seen = PdfAccess::from_permissions(flags);
    assert!(seen.print && seen.modify && seen.other_restricted);
    assert!(!flags.contains(Permissions::COPYABLE));
    assert!(flags.contains(Permissions::ANNOTABLE));
    // The content is intact and readable after the round trip.
    let page = *doc.get_pages().values().next().unwrap();
    let content = String::from_utf8(doc.get_page_content(page)).unwrap();
    assert_eq!(content.matches("/S0_0 Do").count(), 9);
}

#[test]
fn a_pdf_without_restrictions_exports_as_before_and_stays_plain() {
    let d = dir("plain");
    for (name, permissions) in [("plain.pdf", None), ("open.pdf", Some(all()))] {
        let input = source(&d, name, permissions);
        let out = d.join(format!("out-{name}"));
        export_pdf(&input, &out, &job()).unwrap();
        let doc = Document::load(&out).unwrap();
        assert!(!doc.was_encrypted(), "{name}: nothing to carry over");
        assert_eq!(doc.get_pages().len(), 1);
    }
}

#[test]
fn several_sources_give_the_output_what_all_of_them_allow() {
    let d = dir("several");
    let a = Document::load(source(&d, "a.pdf", Some(all() - Permissions::COPYABLE))).unwrap();
    let b = Document::load(source(&d, "b.pdf", Some(all() - Permissions::ANNOTABLE))).unwrap();
    let plain = Document::load(source(&d, "c.pdf", None)).unwrap();
    let merged = access::output_permissions(&[(0, &a), (1, &plain), (2, &b)]).unwrap();
    assert!(!merged.contains(Permissions::COPYABLE));
    assert!(!merged.contains(Permissions::ANNOTABLE));
    assert!(merged.contains(Permissions::PRINTABLE));
    assert!(access::output_permissions(&[(0, &plain)]).is_none());
    // A locked one among them is named by its document id.
    let locked_doc =
        Document::load(source(&d, "d.pdf", Some(all() - Permissions::PRINTABLE))).unwrap();
    let err = access::check_sources(&[(0, &plain), (7, &locked_doc)]).unwrap_err();
    assert_eq!(locked(err), (7, "printing".into()));
}

#[test]
fn the_flags_are_read_when_a_pdf_opens() {
    let Ok(pdfium) = bind_pdfium(&[]) else {
        assert!(
            std::env::var_os("CI").is_none(),
            "pdfium not available in CI"
        );
        eprintln!("SKIPPED: pdfium not available (set PDFIUM_LIB_PATH)");
        return;
    };
    let d = dir("open");
    let seen = |name: &str, p: Option<Permissions>| {
        document_info(&pdfium, &source(&d, name, p)).unwrap().access
    };
    assert_eq!(seen("plain.pdf", None), PdfAccess::default());
    assert_eq!(seen("open.pdf", Some(all())), PdfAccess::default());
    assert_eq!(
        seen("noprint.pdf", Some(all() - Permissions::PRINTABLE)).refusal(),
        Some("printing")
    );
    assert_eq!(
        seen("nomodify.pdf", Some(all() - Permissions::MODIFIABLE)).refusal(),
        Some("modifying")
    );
    // "No copying" as Acrobat sets it clears both copy flags (pdfium reads the second one on newer PDFs).
    let no_copy = all() - Permissions::COPYABLE - Permissions::COPYABLE_FOR_ACCESSIBILITY;
    let copy = seen("nocopy.pdf", Some(no_copy));
    assert!(copy.other_restricted && copy.refusal().is_none());

    // And the exported file opens with the same restriction, without a password.
    let input = source(&d, "src.pdf", Some(no_copy));
    let out = d.join("exported.pdf");
    export_pdf(&input, &out, &job()).unwrap();
    let info = document_info(&pdfium, &out).unwrap();
    assert_eq!(info.page_count, 1);
    assert!(info.access.other_restricted && info.access.refusal().is_none());
}

#[test]
fn restrictions_are_carried_even_when_the_base_pdf_has_no_file_identifier() {
    let mut doc = sample_pdf();
    assert!(doc.trailer.get(b"ID").is_err());
    access::apply_permissions(&mut doc, all() - Permissions::COPYABLE, 0).unwrap();
    let d = dir("noid");
    let path = d.join("out.pdf");
    doc.save(&path).unwrap();
    let flags = access::permissions_of(&Document::load(&path).unwrap()).unwrap();
    assert!(!flags.contains(Permissions::COPYABLE));
}
