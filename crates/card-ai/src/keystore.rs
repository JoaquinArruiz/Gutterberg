//! Where API keys live. The app's implementation is the system keychain (in the Tauri shell); there is
//! deliberately no way to get a key back out to the interface, and no file or setting that holds one.

use crate::error::{AiError, Result};
use crate::provider::ProviderKind;
use std::collections::HashMap;
use std::sync::Mutex;

pub trait KeyStore {
    /// The saved key of a provider, if any.
    fn get(&self, provider: ProviderKind) -> Result<Option<String>>;
    fn set(&self, provider: ProviderKind, key: &str) -> Result<()>;
    /// Removes the key; removing one that is not there is fine.
    fn delete(&self, provider: ProviderKind) -> Result<()>;

    fn has(&self, provider: ProviderKind) -> Result<bool> {
        Ok(self.get(provider)?.is_some())
    }
}

/// Keys held in memory: for tests, and the stand-in when no keychain is wanted.
#[derive(Default)]
pub struct MemoryKeys(Mutex<HashMap<ProviderKind, String>>);

impl KeyStore for MemoryKeys {
    fn get(&self, provider: ProviderKind) -> Result<Option<String>> {
        Ok(self
            .0
            .lock()
            .map_err(|e| AiError::Keychain(e.to_string()))?
            .get(&provider)
            .cloned())
    }

    fn set(&self, provider: ProviderKind, key: &str) -> Result<()> {
        self.0
            .lock()
            .map_err(|e| AiError::Keychain(e.to_string()))?
            .insert(provider, key.to_string());
        Ok(())
    }

    fn delete(&self, provider: ProviderKind) -> Result<()> {
        self.0
            .lock()
            .map_err(|e| AiError::Keychain(e.to_string()))?
            .remove(&provider);
        Ok(())
    }
}
