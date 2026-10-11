//! Twist's compile pass as a Node addon: `compile(source, path, hot?)`, throwing when the file does not parse.

use napi_derive::napi;

/// `source` (the file at `path`) with its JSX marked for Twist and its fixed markup made templates; `hot`: each
/// component's mark also names it, for hot reload.
#[napi]
pub fn compile(source: String, path: String, hot: Option<bool>) -> napi::Result<String> {
    twist_compiler::compile_with(&source, &path, hot.unwrap_or(false)).map_err(napi::Error::from_reason)
}
