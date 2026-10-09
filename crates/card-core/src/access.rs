//! What a PDF's publisher allows (the permission flags of an encrypted PDF), and what the export does about it.
//!
//! A PDF locked against printing or modifying is refused: Gutterberg rebuilds the file, which a publisher who
//! locked it did not allow. Any other restriction (copying text, annotating, ...) is kept: the output gets the
//! same permissions as its sources (the most restrictive of them, when several PDFs share the sheets).

use crate::card::DocumentId;
use crate::error::{Error, Result};
use lopdf::encryption::crypt_filters::{Aes128CryptFilter, CryptFilter};
use lopdf::{Document, EncryptionState, EncryptionVersion, Object, Permissions, StringFormat};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::Arc;

/// Every permission flag that PDF defines (the rest of the 32 bits is reserved).
const KNOWN: Permissions = Permissions::PRINTABLE
    .union(Permissions::MODIFIABLE)
    .union(Permissions::COPYABLE)
    .union(Permissions::ANNOTABLE)
    .union(Permissions::FILLABLE)
    .union(Permissions::COPYABLE_FOR_ACCESSIBILITY)
    .union(Permissions::ASSEMBLABLE)
    .union(Permissions::PRINTABLE_IN_HIGH_QUALITY);

/// The two things that make a PDF unusable here: the reason a locked PDF is refused.
pub const LOCK_PRINTING: &str = "printing";
pub const LOCK_MODIFYING: &str = "modifying";
/// The output could not carry the source's restrictions.
pub const LOCK_UNSUPPORTED: &str = "restrictions";

/// What the publisher allows, in the terms the app shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PdfAccess {
    /// Printing is allowed (at any quality).
    pub print: bool,
    /// Changing the document is allowed.
    pub modify: bool,
    /// Some other action is not allowed (copying text, annotating, filling forms, ...).
    pub other_restricted: bool,
}

impl Default for PdfAccess {
    /// A PDF without restrictions.
    fn default() -> Self {
        Self {
            print: true,
            modify: true,
            other_restricted: false,
        }
    }
}

impl PdfAccess {
    pub fn from_permissions(p: Permissions) -> Self {
        let others = KNOWN.difference(Permissions::PRINTABLE.union(Permissions::MODIFIABLE));
        Self {
            print: p.contains(Permissions::PRINTABLE),
            modify: p.contains(Permissions::MODIFIABLE),
            other_restricted: !p.contains(others),
        }
    }

    /// Why this PDF cannot be used, if it cannot: [`LOCK_PRINTING`] or [`LOCK_MODIFYING`].
    pub fn refusal(&self) -> Option<&'static str> {
        if !self.print {
            Some(LOCK_PRINTING)
        } else if !self.modify {
            Some(LOCK_MODIFYING)
        } else {
            None
        }
    }

    pub fn is_restricted(&self) -> bool {
        !self.print || !self.modify || self.other_restricted
    }
}

/// The permissions an encrypted PDF was opened with; `None` for a PDF that was never encrypted.
pub fn permissions_of(doc: &Document) -> Option<Permissions> {
    doc.encryption_state.as_ref().map(|s| s.permissions())
}

/// What the publisher allows for `doc`.
pub fn access_of(doc: &Document) -> PdfAccess {
    permissions_of(doc)
        .map(PdfAccess::from_permissions)
        .unwrap_or_default()
}

/// Refuses the first source locked against printing or modifying.
pub fn check_sources(docs: &[(DocumentId, &Document)]) -> Result<()> {
    for (id, doc) in docs {
        if let Some(reason) = access_of(doc).refusal() {
            return Err(Error::PdfLocked {
                document_id: *id,
                reason: reason.into(),
            });
        }
    }
    Ok(())
}

/// The permissions the output must carry: the flags every restricted source allows. `None` when no source is
/// restricted, so the output is a plain PDF as before.
pub fn output_permissions(docs: &[(DocumentId, &Document)]) -> Option<Permissions> {
    let restricted: Vec<Permissions> = docs
        .iter()
        .filter_map(|(_, d)| permissions_of(d))
        .filter(|p| PdfAccess::from_permissions(*p).is_restricted())
        .collect();
    let first = *restricted.first()?;
    Some(restricted.into_iter().fold(first, |a, b| a & b))
}

/// A password nobody knows: the restrictions hold, and the file opens without asking for anything.
fn owner_password() -> String {
    use std::hash::{BuildHasher, Hasher};
    (0..4)
        .map(|_| {
            let mut h = std::collections::hash_map::RandomState::new().build_hasher();
            h.write_u8(0);
            format!("{:016x}", h.finish())
        })
        .collect()
}

/// Encrypts `doc` (AES-128, opens with no password) so it carries `permissions`. If that cannot be done the
/// export is refused instead: the restrictions are never dropped silently.
pub fn apply_permissions(
    doc: &mut Document,
    permissions: Permissions,
    document_id: DocumentId,
) -> Result<()> {
    let refuse = || Error::PdfLocked {
        document_id,
        reason: LOCK_UNSUPPORTED.into(),
    };
    // Encrypting needs the file identifier; a document that was never encrypted may not have one yet.
    if doc.trailer.get(b"ID").is_err() {
        let id = Object::String(
            owner_password().into_bytes()[..16].to_vec(),
            StringFormat::Hexadecimal,
        );
        doc.trailer.set("ID", Object::Array(vec![id.clone(), id]));
    }
    let owner = owner_password();
    let filter: Arc<dyn CryptFilter> = Arc::new(Aes128CryptFilter);
    let version = EncryptionVersion::V4 {
        document: doc,
        encrypt_metadata: true,
        crypt_filters: BTreeMap::from([(b"StdCF".to_vec(), filter)]),
        stream_filter: b"StdCF".to_vec(),
        string_filter: b"StdCF".to_vec(),
        owner_password: &owner,
        user_password: "",
        permissions,
    };
    let state = EncryptionState::try_from(version).map_err(|_| refuse())?;
    doc.encrypt(&state).map_err(|_| refuse())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_flags_into_what_the_app_shows() {
        assert_eq!(PdfAccess::from_permissions(KNOWN), PdfAccess::default());
        let no_print = PdfAccess::from_permissions(KNOWN - Permissions::PRINTABLE);
        assert_eq!(no_print.refusal(), Some(LOCK_PRINTING));
        let no_modify = PdfAccess::from_permissions(KNOWN - Permissions::MODIFIABLE);
        assert_eq!(no_modify.refusal(), Some(LOCK_MODIFYING));
        let no_copy = PdfAccess::from_permissions(KNOWN - Permissions::COPYABLE);
        assert!(no_copy.other_restricted && no_copy.refusal().is_none());
        assert!(no_copy.is_restricted());
        assert!(!PdfAccess::default().is_restricted());
    }

    #[test]
    fn printing_is_named_first_when_both_are_locked() {
        let both = PdfAccess::from_permissions(Permissions::empty());
        assert_eq!(both.refusal(), Some(LOCK_PRINTING));
    }
}
