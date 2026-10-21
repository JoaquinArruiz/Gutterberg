//! Whether this copy came from the Microsoft Store. The Store installs Gutterberg as an MSIX package and keeps it up
//! to date itself, so a Store copy never runs the updater (see "Microsoft Store" in `docs/releasing.md`).

/// True when the app runs from an MSIX package, which is how the Microsoft Store installs it.
#[cfg(windows)]
pub fn is_store_install() -> bool {
    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentPackageFullName(length: *mut u32, name: *mut u16) -> i32;
    }
    const APPMODEL_ERROR_NO_PACKAGE: i32 = 15700;
    let mut length = 0u32;
    // Without a buffer it only says whether there is a name: ERROR_INSUFFICIENT_BUFFER inside a package,
    // APPMODEL_ERROR_NO_PACKAGE outside one.
    unsafe {
        GetCurrentPackageFullName(&mut length, std::ptr::null_mut()) != APPMODEL_ERROR_NO_PACKAGE
    }
}

#[cfg(not(windows))]
pub fn is_store_install() -> bool {
    false
}
