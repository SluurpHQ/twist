//! Twist's private property names made short, for a production browser build of Twist's own files (as Solid's build
//! does to its own): `node._pendingValue` becomes `node._e`, by the fixed list in mangle-names.txt
//! (scripts/mangle-names.ts writes it). Every file gets the same names, so a field written in one is read in another.
//!
//! Renamed: member names, object and class keys, destructuring (a shorthand made `_e: _pendingValue`), and a name
//! given as a string to `in`, `o["…"]` and `Object.hasOwn`. Not renamed: other strings, and the names a module exports.

use std::collections::HashMap;
use std::sync::OnceLock;

use oxc::allocator::Allocator;
use oxc::ast::ast::*;
use oxc::ast_visit::{Visit, walk};
use oxc::parser::Parser;
use oxc::span::{GetSpan, SourceType, Span};

fn names() -> &'static HashMap<&'static str, &'static str> {
    static NAMES: OnceLock<HashMap<&str, &str>> = OnceLock::new();
    NAMES.get_or_init(|| include_str!("mangle-names.txt").lines().filter_map(|l| l.split_once(' ')).collect())
}

/// `source` (the file at `path`) with Twist's private names made short; an error if it does not parse.
pub fn mangle(source: &str, path: &str) -> Result<String, String> {
    if !source.contains("_") {
        return Ok(source.to_string());
    }
    let file = path.split('?').next().unwrap_or(path);
    let kind = SourceType::from_path(file).unwrap_or_else(|_| SourceType::ts());
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, kind).parse();
    if !parsed.diagnostics.is_empty() {
        let why: Vec<String> = parsed.diagnostics.iter().map(|d| d.to_string()).collect();
        return Err(format!("{file}: {}", why.join("; ")));
    }
    let mut pass = Rename { names: names(), edits: Vec::new() };
    pass.visit_program(&parsed.program);
    if pass.edits.is_empty() {
        return Ok(source.to_string());
    }
    pass.edits.sort_by_key(|(s, _)| s.start);
    let mut out = String::with_capacity(source.len());
    let mut at = 0;
    for (span, text) in pass.edits {
        // (Two edits of one place, from a node visited twice: the first kept.)
        if (span.start as usize) < at {
            continue;
        }
        out.push_str(&source[at..span.start as usize]);
        out.push_str(&text);
        at = span.end as usize;
    }
    out.push_str(&source[at..]);
    Ok(out)
}

struct Rename {
    names: &'static HashMap<&'static str, &'static str>,
    edits: Vec<(Span, String)>,
}

impl Rename {
    fn short(&self, name: &str) -> Option<&'static str> {
        self.names.get(name).copied()
    }
    /// A string naming a property: renamed in place, its quotes kept.
    fn string(&mut self, s: &StringLiteral) {
        if let Some(short) = self.short(&s.value) {
            self.edits.push((Span::new(s.span.start + 1, s.span.end - 1), short.to_string()));
        }
    }
    fn string_expr(&mut self, e: &Expression) {
        if let Expression::StringLiteral(s) = e {
            self.string(s);
        }
    }
}

impl<'a> Visit<'a> for Rename {
    fn visit_identifier_name(&mut self, it: &IdentifierName<'a>) {
        if let Some(short) = self.short(&it.name) {
            self.edits.push((it.span, short.to_string()));
        }
    }

    // Export and import names stay what other modules ask for.
    fn visit_module_export_name(&mut self, _it: &ModuleExportName<'a>) {}

    fn visit_object_property(&mut self, it: &ObjectProperty<'a>) {
        if it.shorthand
            && let PropertyKey::StaticIdentifier(key) = &it.key
            && let Some(short) = self.short(&key.name)
        {
            self.edits.push((key.span, format!("{short}: {}", key.name)));
            return;
        }
        walk::walk_object_property(self, it);
    }

    fn visit_binding_property(&mut self, it: &BindingProperty<'a>) {
        if it.shorthand
            && let PropertyKey::StaticIdentifier(key) = &it.key
            && let Some(short) = self.short(&key.name)
        {
            // (`{ _x = 1 }`: the key's span is the name alone, its default left where it is.)
            self.edits.push((key.span, format!("{short}: {}", key.name)));
            self.visit_binding_pattern(&it.value);
            return;
        }
        walk::walk_binding_property(self, it);
    }

    fn visit_assignment_target_property_identifier(&mut self, it: &AssignmentTargetPropertyIdentifier<'a>) {
        if let Some(short) = self.short(&it.binding.name) {
            self.edits.push((it.binding.span, format!("{short}: {}", it.binding.name)));
        }
        if let Some(init) = &it.init {
            self.visit_expression(init);
        }
    }

    // `constructor(public _order)` declares a field by a parameter's name: the modifier dropped, the field assigned
    // under its short name where the constructor starts (after `super()`).
    fn visit_method_definition(&mut self, it: &MethodDefinition<'a>) {
        if it.kind == MethodDefinitionKind::Constructor
            && let Some(body) = &it.value.body
        {
            let mut fields = String::new();
            for p in &it.value.params.items {
                let declares = p.accessibility.is_some() || p.readonly || p.r#override;
                if let (true, Some(id)) = (declares, p.pattern.get_binding_identifier())
                    && let Some(short) = self.short(&id.name)
                {
                    self.edits.push((Span::new(p.span.start, id.span.start), String::new()));
                    fields.push_str(&format!(" this.{short} = {};", id.name));
                }
            }
            if !fields.is_empty() {
                let first_is_super = matches!(body.statements.first(), Some(Statement::ExpressionStatement(s)) if matches!(&s.expression, Expression::CallExpression(c) if matches!(c.callee, Expression::Super(_))));
                let at = if first_is_super { body.statements[0].span().end } else { body.span.start + 1 };
                self.edits.push((Span::new(at, at), fields));
            }
        }
        walk::walk_method_definition(self, it);
    }

    fn visit_property_key(&mut self, it: &PropertyKey<'a>) {
        if let PropertyKey::StringLiteral(s) = it {
            self.string(s);
        }
        walk::walk_property_key(self, it);
    }

    fn visit_computed_member_expression(&mut self, it: &ComputedMemberExpression<'a>) {
        self.string_expr(&it.expression);
        walk::walk_computed_member_expression(self, it);
    }

    fn visit_binary_expression(&mut self, it: &BinaryExpression<'a>) {
        if it.operator == BinaryOperator::In {
            self.string_expr(&it.left);
        }
        walk::walk_binary_expression(self, it);
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        // `Object.hasOwn(o, "…")`, `o.hasOwnProperty("…")`.
        if let Some(m) = it.callee.as_member_expression()
            && let Some(name) = m.static_property_name()
        {
            let arg = match name {
                "hasOwn" => it.arguments.get(1),
                "hasOwnProperty" => it.arguments.first(),
                _ => None,
            };
            if let Some(Argument::StringLiteral(s)) = arg {
                self.string(s);
            }
        }
        walk::walk_call_expression(self, it);
    }
}

#[cfg(test)]
mod tests {
    use super::mangle;

    fn m(s: &str) -> String {
        mangle(s, "a.ts").unwrap()
    }

    #[test]
    fn members_keys_and_classes() {
        assert_eq!(m("a._pendingValue = b?._config;"), "a._e = b?._b;");
        assert_eq!(m("const o = { _config: 1, _flags() {}, get _value() {} };"), "const o = { _b: 1, _h() {}, get _k() {} };");
        assert_eq!(m("class A { _config = 1; _flags() {} }"), "class A { _b = 1; _h() {} }");
        assert_eq!(m("const t: { _config: number } = x;"), "const t: { _b: number } = x;");
    }

    #[test]
    fn parameter_properties() {
        assert_eq!(m("class A { constructor(public _config: X, b) { go(); } }"), "class A { constructor(_config: X, b) { this._b = _config; go(); } }");
        assert_eq!(m("class B extends A { constructor(readonly _flags) { super(1); } }"), "class B extends A { constructor(_flags) { super(1); this._h = _flags; } }");
    }

    #[test]
    fn shorthand_and_destructuring() {
        assert_eq!(m("const _config = 1; f({ _config });"), "const _config = 1; f({ _b: _config });");
        assert_eq!(m("const { _config, _flags: f } = o;"), "const { _b: _config, _h: f } = o;");
        assert_eq!(m("const { _config = 2 } = o;"), "const { _b: _config = 2 } = o;");
        assert_eq!(m("({ _config } = o);"), "({ _b: _config } = o);");
    }

    #[test]
    fn strings_only_where_they_name_a_property() {
        assert_eq!(m(r#"if ("_parent" in o) o["_config"];"#), r#"if ("_i" in o) o["_b"];"#);
        assert_eq!(m(r#"Object.hasOwn(o, "_parent") || o.hasOwnProperty("_flags");"#), r#"Object.hasOwn(o, "_i") || o.hasOwnProperty("_h");"#);
        assert_eq!(m(r#"el.setAttribute("_config", "_flags");"#), r#"el.setAttribute("_config", "_flags");"#);
    }

    #[test]
    fn exports_reserved_and_variables_stay() {
        let s = "export { _config as _flags }; let _parent = 1; a._owner = b._key;";
        assert_eq!(m(s), s);
    }
}
