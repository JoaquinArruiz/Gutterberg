//! API keys in the system keychain (macOS Keychain, Windows Credential Manager, the Secret Service on
//! Linux), one entry per provider. This is the only place a key is stored; nothing here hands one to
//! the interface.

use card_ai::{AiError, KeyStore, ProviderKind};
use std::collections::{hash_map::Entry, HashMap};
use std::sync::Mutex;

const SERVICE: &str = "gutterberg-ai";

#[derive(Default)]
pub struct KeyringStore {
    entries: Mutex<HashMap<ProviderKind, keyring::Entry>>,
}

fn account(kind: ProviderKind) -> &'static str {
    match kind {
        ProviderKind::Anthropic => "anthropic",
        ProviderKind::OpenaiCompatible => "openai-compatible",
        ProviderKind::Gemini => "gemini",
        ProviderKind::Ollama => "ollama",
    }
}

fn failed(e: keyring::Error) -> AiError {
    AiError::Keychain(e.to_string())
}

impl KeyringStore {
    /// Runs `f` on the provider's entry. The outer error is the keychain being unusable; the inner
    /// result is what `f` got from it.
    fn with<T>(
        &self,
        kind: ProviderKind,
        f: impl FnOnce(&keyring::Entry) -> keyring::Result<T>,
    ) -> Result<keyring::Result<T>, AiError> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|e| AiError::Keychain(e.to_string()))?;
        let entry = match entries.entry(kind) {
            Entry::Occupied(e) => e.into_mut(),
            Entry::Vacant(e) => {
                e.insert(keyring::Entry::new(SERVICE, account(kind)).map_err(failed)?)
            }
        };
        Ok(f(entry))
    }
}

impl KeyStore for KeyringStore {
    fn get(&self, provider: ProviderKind) -> Result<Option<String>, AiError> {
        match self.with(provider, |e| e.get_password())? {
            Ok(key) => Ok(Some(key)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(failed(e)),
        }
    }

    fn set(&self, provider: ProviderKind, key: &str) -> Result<(), AiError> {
        self.with(provider, |e| e.set_password(key))?
            .map_err(failed)
    }

    fn delete(&self, provider: ProviderKind) -> Result<(), AiError> {
        match self.with(provider, |e| e.delete_credential())? {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(failed(e)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_are_saved_replaced_read_and_deleted_through_the_keychain_entry() {
        // The mock keychain keeps a credential per entry, and the store keeps one entry per provider.
        keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        let store = KeyringStore::default();
        assert_eq!(store.get(ProviderKind::Anthropic).unwrap(), None);
        store.set(ProviderKind::Anthropic, "sk-ant-one").unwrap();
        store.set(ProviderKind::Anthropic, "sk-ant-two").unwrap();
        assert_eq!(
            store.get(ProviderKind::Anthropic).unwrap().as_deref(),
            Some("sk-ant-two")
        );
        assert!(store.has(ProviderKind::Anthropic).unwrap());
        // Another provider has its own entry.
        assert!(!store.has(ProviderKind::Gemini).unwrap());
        store.delete(ProviderKind::Anthropic).unwrap();
        assert_eq!(store.get(ProviderKind::Anthropic).unwrap(), None);
        // Removing what is not there is fine.
        store.delete(ProviderKind::Anthropic).unwrap();
    }

    #[test]
    fn a_keychain_that_fails_is_a_keychain_error_that_does_not_carry_the_key() {
        let e = failed(keyring::Error::NoStorageAccess(Box::new(
            std::io::Error::other("the Secret Service is not running"),
        )));
        let AiError::Keychain(text) = e else {
            panic!("not a keychain error")
        };
        assert!(text.contains("Secret Service"));
        let info = card_core::ErrorInfo::from(AiError::Keychain(text));
        assert_eq!(info.code, "ai_keychain");
    }
}
