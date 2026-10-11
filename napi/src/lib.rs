//! Twist's compile pass as a Node addon: `compile(source, path)`, throwing when the file does not parse.

use napi_derive::napi;

/// `source` (the file at `path`) with its JSX marked for Twist and its fixed markup made templates.
#[napi]
pub fn compile(source: String, path: String) -> napi::Result<String> {
    twist_compiler::compile(&source, &path).map_err(napi::Error::from_reason)
}
