//! Twist's JSX pass (Solid-style files), run before Bun's JSX transform: it marks what in the JSX can change, so the
//! runtime binds it to the DOM instead of reading it once. The JSX stays JSX; only expressions are wrapped.
//!
//! - A dynamic expression (one that calls or reads a property) in a child or an attribute: `{__twist_d(() => e)}`.
//! - A component's children: one lazy child, `{__twist_c(() => <>…</>)}` (a lone function child is left as it is).
//! - A spread: `{...{"$spread$N": () => e}}`, so its getters are read where they are used.
//! - `ref={el}` with a bare variable: `ref={__twist_ref(el, (v) => (el = v))}`.
//! - JSX as a statement: `__twist_k(…)`, kept though its value is unused.
//! - The components the file declares: `__twist_mark`ed where declared, so any React mounts them as Solid-style.
//! - A child `test ? a : b` or `test && a` with JSX in a branch: its test a memo (`__twist_memo`), as Solid compiles it.
//!
//! Then host elements whose markup is fixed become templates (`__twist_t`): made once and copied, each value set where
//! it goes (see `templates`).

use std::collections::HashSet;

use oxc::allocator::Allocator;
use oxc::ast::ast::*;
use oxc::ast_visit::{Visit, walk};
use oxc::parser::Parser;
use oxc::semantic::ScopeFlags;
use oxc::span::{GetSpan, SourceType, Span};

const RUNTIME: &str = "@solidjs/web";

struct Edit {
    start: u32,
    end: u32,
    text: String,
}

/// `source` with its JSX's dynamic parts marked (unchanged if it has nothing to mark); an error if it does not parse.
/// `path` names the file (its extension says TSX or JSX; a `?query` is ignored).
pub fn compile(source: &str, path: &str) -> Result<String, String> {
    compile_with(source, path, false)
}

/// `compile`; `hot`: each component's mark also names it (hot reload keeps one component per name across edits).
pub fn compile_with(source: &str, path: &str, hot: bool) -> Result<String, String> {
    let named = |name: &str| if hot { format!(", {}", json(name)) } else { String::new() };
    let has_jsx = source.as_bytes().windows(2).any(|w| w[0] == b'<' && (w[1].is_ascii_alphabetic() || w[1] == b'>'));
    if !has_jsx {
        return Ok(source.to_string());
    }
    let file = path.split('?').next().unwrap_or(path);
    let kind = SourceType::from_path(file).unwrap_or_else(|_| SourceType::tsx());
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, kind).parse();
    if !parsed.diagnostics.is_empty() {
        let why: Vec<String> = parsed.diagnostics.iter().map(|d| d.to_string()).collect();
        return Err(format!("{file}: {}", why.join("; ")));
    }
    let program = &parsed.program;

    let mut assignable = Assignable::default();
    assignable.visit_program(program);
    let mut pass = Pass { source, assignable: assignable.names, edits: Vec::new(), spreads: 0, used: false };
    pass.visit_program(program);

    // The components this file declares: marked where declared (an `export default X` below sees the marked one).
    let mut marks = 0;
    for top in &program.body {
        let declared = match top {
            Statement::ExportDeclaration(e) => Some(Declared::Of(&e.declaration)),
            Statement::ExportDefaultDeclaration(e) => match &e.declaration {
                ExportDefaultDeclarationKind::FunctionDeclaration(f) => Some(Declared::Function(f)),
                _ => None,
            },
            Statement::FunctionDeclaration(f) => Some(Declared::Function(f)),
            Statement::VariableDeclaration(v) => Some(Declared::Variables(v)),
            _ => None,
        };
        let declared = match declared {
            Some(Declared::Of(Declaration::FunctionDeclaration(f))) => Declared::Function(f),
            Some(Declared::Of(Declaration::VariableDeclaration(v))) => Declared::Variables(v),
            Some(d @ (Declared::Function(_) | Declared::Variables(_))) => d,
            _ => continue,
        };
        match declared {
            Declared::Function(f) => {
                if let Some(id) = &f.id
                    && capitalised(&id.name)
                {
                    let end = top.span().end;
                    pass.edits.push(Edit { start: end, end, text: format!("\n{0} = __twist_mark({0}{1});", id.name, named(&id.name)) });
                    marks += 1;
                }
            }
            Declared::Variables(v) => {
                for d in &v.declarations {
                    let id = d.id.get_binding_identifier().filter(|i| capitalised(&i.name));
                    if let (Some(id), Some(init @ (Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)))) = (id, &d.init) {
                        let s = init.span();
                        pass.edits.push(Edit { start: s.start, end: s.end, text: format!("__twist_mark({}{})", &source[s.start as usize..s.end as usize], named(&id.name)) });
                        marks += 1;
                    }
                }
            }
            Declared::Of(_) => {}
        }
    }
    let mut out = if pass.edits.is_empty() { source.to_string() } else { apply(source, pass.edits) };
    if pass.used || marks > 0 {
        out = format!("import {{ __twist_d, __twist_c, __twist_ref, __twist_k, __twist_mark, __twist_memo }} from \"{RUNTIME}\";\n{out}");
    }
    Ok(templates(&out, kind))
}

enum Declared<'b, 'a> {
    Of(&'b Declaration<'a>),
    Function(&'b Function<'a>),
    Variables(&'b VariableDeclaration<'a>),
}

fn capitalised(name: &str) -> bool {
    name.starts_with(|c: char| c.is_ascii_uppercase())
}

/// Names a `ref` may assign to: declared with let or var (a const, a function or an import is only called).
#[derive(Default)]
struct Assignable {
    names: HashSet<String>,
    inside: bool,
}
impl<'a> Visit<'a> for Assignable {
    fn visit_variable_declaration(&mut self, v: &VariableDeclaration<'a>) {
        let was = self.inside;
        if v.kind != VariableDeclarationKind::Const {
            for d in &v.declarations {
                self.inside = true;
                self.visit_binding_pattern(&d.id);
                self.inside = was;
                if let Some(init) = &d.init {
                    self.visit_expression(init);
                }
            }
            return;
        }
        walk::walk_variable_declaration(self, v);
    }
    fn visit_binding_identifier(&mut self, id: &BindingIdentifier<'a>) {
        if self.inside {
            self.names.insert(id.name.to_string());
        }
    }
    fn visit_assignment_pattern(&mut self, p: &AssignmentPattern<'a>) {
        // A default's value names nothing declared here.
        self.visit_binding_pattern(&p.left);
        let was = std::mem::replace(&mut self.inside, false);
        self.visit_expression(&p.right);
        self.inside = was;
    }
}

/// Whether an expression can change: it calls something or reads a property (functions and JSX aside).
#[derive(Default)]
struct Dynamic {
    found: bool,
}
impl<'a> Visit<'a> for Dynamic {
    fn visit_call_expression(&mut self, _: &CallExpression<'a>) {
        self.found = true;
    }
    fn visit_member_expression(&mut self, _: &MemberExpression<'a>) {
        self.found = true;
    }
    fn visit_tagged_template_expression(&mut self, _: &TaggedTemplateExpression<'a>) {
        self.found = true;
    }
    fn visit_new_expression(&mut self, _: &NewExpression<'a>) {
        self.found = true;
    }
    fn visit_chain_expression(&mut self, _: &ChainExpression<'a>) {
        self.found = true;
    }
    fn visit_arrow_function_expression(&mut self, _: &ArrowFunctionExpression<'a>) {}
    fn visit_function(&mut self, _: &Function<'a>, _: ScopeFlags) {}
    fn visit_jsx_element(&mut self, _: &JSXElement<'a>) {}
    fn visit_jsx_fragment(&mut self, _: &JSXFragment<'a>) {}
}
fn dynamic(e: &Expression) -> bool {
    let mut d = Dynamic::default();
    d.visit_expression(e);
    d.found
}

struct Pass<'s> {
    source: &'s str,
    assignable: HashSet<String>,
    edits: Vec<Edit>,
    spreads: usize,
    used: bool,
}

impl Pass<'_> {
    fn text(&self, s: Span) -> &str {
        &self.source[s.start as usize..s.end as usize]
    }
    fn wrap(&mut self, e: &Expression, f: &str) {
        self.used = true;
        let s = e.span();
        let text = format!("{f}(() => ({}))", self.text(s));
        self.edits.push(Edit { start: s.start, end: s.end, text });
    }
    /// A child; `memo`: one of a component's several children, whose dynamic expression is a memo (as Solid compiles
    /// it), so reading the children again does not compute it again.
    fn child<'a>(&mut self, c: &JSXChild<'a>, memo: bool) {
        match c {
            JSXChild::Element(e) => self.visit_jsx_element(e),
            JSXChild::Fragment(f) => self.visit_jsx_fragment(f),
            JSXChild::ExpressionContainer(x) => {
                if let Some(e) = x.expression.as_expression() {
                    self.visit_expression(e);
                    if dynamic(e) && !self.condition(e) {
                        self.wrap(e, if memo { "__twist_memo" } else { "__twist_d" });
                    }
                }
            }
            _ => {}
        }
    }
    /// A child `test ? a : b` or `test && a` with JSX in a branch, as Solid compiles it: the test a memo, so the branch is
    /// made again only when the test flips.
    fn condition(&mut self, e: &Expression) -> bool {
        let (test, ternary) = match e {
            Expression::ConditionalExpression(c) if has_jsx(&c.consequent) || has_jsx(&c.alternate) => (&c.test, true),
            Expression::LogicalExpression(l) if l.operator == LogicalOperator::And && has_jsx(&l.right) => (&l.left, false),
            _ => return false,
        };
        if !dynamic(test) {
            return false;
        }
        self.used = true;
        let (s, t) = (e.span(), test.span());
        let not = if ternary { "!!" } else { "" };
        self.edits.push(Edit { start: s.start, end: s.start, text: format!("__twist_d((() => {{ const _c$ = __twist_memo(() => {not}(") });
        self.edits.push(Edit { start: t.end, end: t.end, text: ")); return () => _c$()".into() });
        self.edits.push(Edit { start: s.end, end: s.end, text: "; })())".into() });
        true
    }
}

/// Whether an expression has JSX in it (functions aside: what they return is theirs).
#[derive(Default)]
struct HasJsx {
    found: bool,
}
impl<'a> Visit<'a> for HasJsx {
    fn visit_jsx_element(&mut self, _: &JSXElement<'a>) {
        self.found = true;
    }
    fn visit_jsx_fragment(&mut self, _: &JSXFragment<'a>) {
        self.found = true;
    }
    fn visit_arrow_function_expression(&mut self, _: &ArrowFunctionExpression<'a>) {}
    fn visit_function(&mut self, _: &Function<'a>, _: ScopeFlags) {}
}
fn has_jsx(e: &Expression) -> bool {
    let mut h = HasJsx::default();
    h.visit_expression(e);
    h.found
}

fn is_component(name: &JSXElementName) -> bool {
    match name {
        JSXElementName::MemberExpression(_) => true,
        JSXElementName::Identifier(i) => i.name.starts_with(|c: char| c.is_ascii_uppercase() || c == '_' || c == '$'),
        JSXElementName::IdentifierReference(i) => i.name.starts_with(|c: char| c.is_ascii_uppercase() || c == '_' || c == '$'),
        _ => false,
    }
}

impl<'a> Visit<'a> for Pass<'_> {
    fn visit_expression_statement(&mut self, s: &ExpressionStatement<'a>) {
        if matches!(s.expression, Expression::JSXElement(_) | Expression::JSXFragment(_)) {
            self.used = true;
            let sp = s.expression.span();
            self.edits.push(Edit { start: sp.start, end: sp.start, text: "__twist_k(".into() });
            self.edits.push(Edit { start: sp.end, end: sp.end, text: ")".into() });
        }
        walk::walk_expression_statement(self, s);
    }

    fn visit_jsx_fragment(&mut self, f: &JSXFragment<'a>) {
        for c in &f.children {
            self.child(c, false);
        }
    }

    fn visit_jsx_element(&mut self, el: &JSXElement<'a>) {
        let open = &el.opening_element;
        let component = is_component(&open.name);
        // Several refs on one element: one, an array of them in order (as Solid's compilers merge them).
        let mut merged_refs = false;
        if !component {
            let refs: Vec<&JSXAttribute> = open
                .attributes
                .iter()
                .filter_map(|a| match a {
                    JSXAttributeItem::Attribute(a) if matches!(&a.name, JSXAttributeName::Identifier(i) if i.name == "ref") => Some(&**a),
                    _ => None,
                })
                .collect();
            let exprs: Vec<&Expression> = refs
                .iter()
                .filter_map(|a| match &a.value {
                    Some(JSXAttributeValue::ExpressionContainer(x)) => x.expression.as_expression(),
                    _ => None,
                })
                .collect();
            if refs.len() > 1 && exprs.len() == refs.len() {
                let joined = exprs.iter().map(|e| self.text(e.span()).to_string()).collect::<Vec<_>>().join(", ");
                let first = exprs[0].span();
                self.edits.push(Edit { start: first.start, end: first.end, text: format!("[{joined}]") });
                for a in &refs[1..] {
                    self.edits.push(Edit { start: a.span.start, end: a.span.end, text: String::new() });
                }
                merged_refs = true;
            }
        }
        for a in &open.attributes {
            if merged_refs
                && let JSXAttributeItem::Attribute(x) = a
                && matches!(&x.name, JSXAttributeName::Identifier(i) if i.name == "ref")
            {
                continue;
            }
            let a = match a {
                JSXAttributeItem::SpreadAttribute(s) => {
                    self.used = true;
                    let text = format!("{{...{{\"$spread${}\": () => ({})}}}}", self.spreads, self.text(s.argument.span()));
                    self.spreads += 1;
                    self.edits.push(Edit { start: s.span.start, end: s.span.end, text });
                    continue;
                }
                JSXAttributeItem::Attribute(a) => a,
            };
            let name = match &a.name {
                JSXAttributeName::Identifier(i) => i.name.as_str(),
                _ => "",
            };
            let e = match &a.value {
                Some(JSXAttributeValue::ExpressionContainer(x)) => match x.expression.as_expression() {
                    Some(e) => e,
                    None => continue,
                },
                Some(JSXAttributeValue::Element(e)) => {
                    self.visit_jsx_element(e);
                    continue;
                }
                Some(JSXAttributeValue::Fragment(f)) => {
                    self.visit_jsx_fragment(f);
                    continue;
                }
                _ => continue,
            };
            if name == "ref"
                && let Expression::Identifier(id) = e
                && self.assignable.contains(id.name.as_str())
            {
                self.used = true;
                let s = e.span();
                let text = format!("__twist_ref({0}, (v) => ({0} = v))", id.name);
                self.edits.push(Edit { start: s.start, end: s.end, text });
                continue;
            }
            self.visit_expression(e);
            // An element's event handler is read when the event comes; a ref is called once. (A component's onX is a prop.)
            let handler = name.len() > 2 && name.starts_with("on") && name.as_bytes()[2].is_ascii_uppercase();
            // (A component's prop with JSX in it is a getter too, as Solid's: what it makes is made where it is read.)
            if (dynamic(e) || (component && has_jsx(e))) && name != "ref" && (component || !handler) {
                self.wrap(e, "__twist_d");
            }
        }
        let kids: Vec<&JSXChild> = el
            .children
            .iter()
            .filter(|c| match c {
                JSXChild::Text(t) => !t.value.trim().is_empty(),
                JSXChild::ExpressionContainer(x) => x.expression.as_expression().is_some(),
                _ => true,
            })
            .collect();
        for c in &el.children {
            self.child(c, component && kids.len() > 1);
        }
        if component && !kids.is_empty() {
            let lone_fn = kids.len() == 1
                && matches!(kids[0], JSXChild::ExpressionContainer(x) if matches!(x.expression.as_expression(), Some(Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_))));
            if !lone_fn {
                // All children as one lazy child: built when the component reads them.
                self.used = true;
                let first = el.children.first().unwrap().span().start;
                let last = el.children.last().unwrap().span().end;
                self.edits.push(Edit { start: first, end: first, text: "{__twist_c(() => <>".into() });
                self.edits.push(Edit { start: last, end: last, text: "</>)}".into() });
            }
        }
    }
}

// ---------------------------------------------------------------- templates

/// Tags made in the SVG and MathML namespaces: left to the runtime (the same lists as the runtime's tags.ts).
const SVG_TAGS: &[&str] = &[
    "svg", "g", "path", "circle", "ellipse", "line", "polygon", "polyline", "rect", "text", "tspan", "textPath", "defs", "use", "symbol", "marker", "mask", "pattern", "clipPath",
    "linearGradient", "radialGradient", "stop", "filter", "feBlend", "feColorMatrix", "feComponentTransfer", "feComposite", "feConvolveMatrix", "feDiffuseLighting",
    "feDisplacementMap", "feFlood", "feGaussianBlur", "feImage", "feMerge", "feMergeNode", "feMorphology", "feOffset", "feSpecularLighting", "feTile", "feTurbulence",
    "foreignObject", "image", "switch", "desc", "metadata", "title", "animate", "animateMotion", "animateTransform", "set", "view",
];
const MATH_TAGS: &[&str] = &[
    "math", "mi", "mn", "mo", "ms", "mtext", "mrow", "msup", "msub", "mfrac", "msqrt", "mroot", "mtable", "mtr", "mtd", "mspace", "munder", "mover", "munderover", "semantics",
    "annotation",
];
/// A select's options are set before they join it, as the runtime does: left to it.
const LIVE_CHILDREN: &[&str] = &["select", "option", "optgroup"];
/// Attributes set at run time even when written as a string: state kept as properties, and style.
const RUNTIME_ATTRS: &[&str] = &["style", "value", "checked", "selected", "muted", "ref", "key"];

fn tag_of<'a>(el: &JSXElement<'a>) -> &'a str {
    match &el.opening_element.name {
        JSXElementName::Identifier(i) => i.name.as_str(),
        _ => "",
    }
}
fn is_host(tag: &str) -> bool {
    tag.starts_with(|c: char| c.is_ascii_lowercase()) && tag.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()) && !SVG_TAGS.contains(&tag) && !MATH_TAGS.contains(&tag)
}

/// The marked source's host elements whose markup is fixed, as templates: `__twist_t(spec)` once at the top, then a
/// call with the values in source order where each element was. The rest of the JSX is left as it is.
fn templates(source: &str, kind: SourceType) -> String {
    if !source.as_bytes().windows(2).any(|w| w[0] == b'<' && w[1].is_ascii_lowercase()) {
        return source.to_string();
    }
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, kind).parse();
    if !parsed.diagnostics.is_empty() {
        return source.to_string();
    }
    let mut specs: Vec<String> = Vec::new();
    let span = parsed.program.span;
    let body = {
        let mut r = Rewrite { source, specs: &mut specs, edits: Vec::new(), in_jsx: false };
        r.visit_program(&parsed.program);
        splice(source, span, r.edits)
    };
    if specs.is_empty() {
        return source.to_string();
    }
    format!("import {{ __twist_t }} from \"{RUNTIME}\";\n{}\n{body}", specs.join("\n"))
}

/// `span` of `source` with `edits` (none inside another) in place.
fn splice(source: &str, span: Span, mut edits: Vec<Edit>) -> String {
    edits.sort_by_key(|e| e.start);
    let mut out = String::new();
    let mut at = span.start;
    for e in edits {
        out.push_str(&source[at as usize..e.start as usize]);
        out.push_str(&e.text);
        at = e.end;
    }
    out.push_str(&source[at as usize..span.end as usize]);
    out
}

/// Finds the outermost templatable elements under what it visits, each replaced by its template's call.
struct Rewrite<'s, 'v> {
    source: &'s str,
    specs: &'v mut Vec<String>,
    edits: Vec<Edit>,
    /// Whether what is visited sits in JSX (a child, an attribute's value): a call there goes in braces.
    in_jsx: bool,
}

impl<'s> Rewrite<'s, '_> {
    /// An expression's text with the templates inside it made.
    fn text(&mut self, e: &Expression) -> String {
        let mut r = Rewrite { source: self.source, specs: &mut *self.specs, edits: Vec::new(), in_jsx: false };
        r.visit_expression(e);
        splice(self.source, e.span(), r.edits)
    }
    /// An element's text with the templates inside it made (it is not one itself).
    fn element_text(&mut self, el: &JSXElement) -> String {
        let mut r = Rewrite { source: self.source, specs: &mut *self.specs, edits: Vec::new(), in_jsx: true };
        r.inside(el);
        splice(self.source, el.span, r.edits)
    }
    fn templatable(&self, el: &JSXElement) -> bool {
        let tag = tag_of(el);
        is_host(tag)
            && !LIVE_CHILDREN.contains(&tag)
            && el.opening_element.attributes.iter().all(|a| match a {
                JSXAttributeItem::Attribute(a) => match &a.value {
                    Some(JSXAttributeValue::StringLiteral(s)) => attr_text(self.source, s.span).is_some(),
                    _ => true,
                },
                JSXAttributeItem::SpreadAttribute(_) => false,
            })
    }
    /// An element's own attributes and children walked (the element itself not made a template).
    fn inside(&mut self, el: &JSXElement) {
        for a in &el.opening_element.attributes {
            match a {
                JSXAttributeItem::SpreadAttribute(s) => {
                    self.in_jsx = false;
                    self.visit_expression(&s.argument);
                }
                JSXAttributeItem::Attribute(a) => match &a.value {
                    Some(JSXAttributeValue::ExpressionContainer(x)) => {
                        if let Some(e) = x.expression.as_expression() {
                            self.in_jsx = false;
                            self.visit_expression(e);
                        }
                    }
                    Some(JSXAttributeValue::Element(e)) => {
                        self.in_jsx = true;
                        self.visit_jsx_element(e);
                    }
                    Some(JSXAttributeValue::Fragment(f)) => self.visit_jsx_fragment(f),
                    _ => {}
                },
            }
        }
        self.children(&el.children);
    }
    fn children(&mut self, kids: &[JSXChild]) {
        for c in kids {
            match c {
                JSXChild::Element(e) => {
                    self.in_jsx = true;
                    self.visit_jsx_element(e);
                }
                JSXChild::Fragment(f) => self.visit_jsx_fragment(f),
                JSXChild::ExpressionContainer(x) => {
                    if let Some(e) = x.expression.as_expression() {
                        self.in_jsx = false;
                        self.visit_expression(e);
                    }
                }
                JSXChild::Spread(s) => {
                    self.in_jsx = false;
                    self.visit_expression(&s.expression);
                }
                JSXChild::Text(_) => {}
            }
        }
    }
    /// An element as its template's call: its spec once at the top, its values in source order.
    fn template(&mut self, el: &JSXElement) -> String {
        let mut values: Vec<String> = Vec::new();
        let spec = self.spec(el, &mut values);
        self.specs.push(format!("const _tmpl${} = /*@__PURE__*/ __twist_t({spec});", self.specs.len()));
        format!("_tmpl${}([{}])", self.specs.len() - 1, values.join(", "))
    }
    /// `[tag, static attributes, attributes set at run time, children(, 1 when one set at run time follows a static one)]`.
    fn spec(&mut self, el: &JSXElement, values: &mut Vec<String>) -> String {
        let (mut fixed, mut slots, mut mixed) = (Vec::new(), Vec::new(), false);
        for a in &el.opening_element.attributes {
            let JSXAttributeItem::Attribute(a) = a else { continue };
            let name = &self.source[a.name.span().start as usize..a.name.span().end as usize];
            if name == "key" {
                continue;
            }
            let plain = name.starts_with(|c: char| c.is_ascii_lowercase()) && name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
            match &a.value {
                Some(JSXAttributeValue::StringLiteral(s)) if plain && !RUNTIME_ATTRS.contains(&name) => {
                    fixed.push(json(name));
                    fixed.push(json(&attr_text(self.source, s.span).unwrap_or_default()));
                    continue;
                }
                _ => {}
            }
            if !fixed.is_empty() {
                mixed = true;
            }
            slots.push(json(name));
            values.push(match &a.value {
                None => "true".into(),
                Some(JSXAttributeValue::StringLiteral(s)) => json(&attr_text(self.source, s.span).unwrap_or_default()),
                Some(JSXAttributeValue::ExpressionContainer(x)) => match x.expression.as_expression() {
                    Some(e) => self.text(e),
                    None => "undefined".into(),
                },
                Some(JSXAttributeValue::Element(e)) => self.jsx_value(e),
                Some(JSXAttributeValue::Fragment(f)) => self.source[f.span.start as usize..f.span.end as usize].to_string(),
            });
        }
        let mut kids: Vec<String> = Vec::new();
        for c in &el.children {
            match c {
                JSXChild::Text(t) => match jsx_text(t.value.as_str()) {
                    // An entity this pass does not know: the JSX transform decodes it.
                    None => {
                        kids.push("0".into());
                        values.push(format!("<>{}</>", t.value));
                    }
                    Some(s) if !s.is_empty() => kids.push(json(&s)),
                    _ => {}
                },
                JSXChild::ExpressionContainer(x) => {
                    if let Some(e) = x.expression.as_expression() {
                        kids.push("0".into());
                        values.push(self.text(e));
                    }
                }
                JSXChild::Element(e) if self.templatable(e) => kids.push(self.spec(e, values)),
                JSXChild::Element(e) => {
                    kids.push("0".into());
                    values.push(self.jsx_value(e));
                }
                JSXChild::Fragment(f) => {
                    kids.push("0".into());
                    let mut r = Rewrite { source: self.source, specs: &mut *self.specs, edits: Vec::new(), in_jsx: true };
                    r.visit_jsx_fragment(f);
                    values.push(splice(self.source, f.span, r.edits));
                }
                JSXChild::Spread(s) => {
                    kids.push("0".into());
                    values.push(self.text(&s.expression));
                }
            }
        }
        let tail = if mixed { ", 1" } else { "" };
        format!("[{}, [{}], [{}], [{}]{tail}]", json(tag_of(el)), fixed.join(", "), slots.join(", "), kids.join(", "))
    }
    /// A JSX element given as a value (not part of the template): itself a template if it can be one.
    fn jsx_value(&mut self, e: &JSXElement) -> String {
        if self.templatable(e) { self.template(e) } else { self.element_text(e) }
    }
}

impl<'a> Visit<'a> for Rewrite<'_, '_> {
    fn visit_jsx_element(&mut self, el: &JSXElement<'a>) {
        let in_jsx = self.in_jsx;
        if self.templatable(el) {
            let call = self.template(el);
            self.edits.push(Edit { start: el.span.start, end: el.span.end, text: if in_jsx { format!("{{{call}}}") } else { call } });
            return;
        }
        // SVG and MathML: left to the runtime, as they are.
        let tag = tag_of(el);
        if tag.starts_with(|c: char| c.is_ascii_lowercase()) && !is_host(tag) {
            return;
        }
        self.inside(el);
        self.in_jsx = in_jsx;
    }
    fn visit_jsx_fragment(&mut self, f: &JSXFragment<'a>) {
        let in_jsx = self.in_jsx;
        self.children(&f.children);
        self.in_jsx = in_jsx;
    }
}

fn json(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_default()
}

/// A string attribute as JSX reads it (entities decoded; None for a named one this pass does not know).
fn attr_text(source: &str, span: Span) -> Option<String> {
    decode_entities(&source[span.start as usize + 1..span.end as usize - 1])
}

/// JSX text as the JSX transform reads it: lines trimmed where they break, blank lines gone, the rest joined by a space
/// (None for an entity this pass does not know).
fn jsx_text(raw: &str) -> Option<String> {
    let lines: Vec<&str> = raw.split(['\n']).map(|l| l.strip_suffix('\r').unwrap_or(l)).collect();
    let last = lines.iter().rposition(|l| l.chars().any(|c| c != ' ' && c != '\t')).unwrap_or(0);
    let mut out = String::new();
    for (i, line) in lines.iter().enumerate() {
        let mut line = line.replace('\t', " ");
        if i != 0 {
            line = line.trim_start_matches(' ').to_string();
        }
        if i != lines.len() - 1 {
            line = line.trim_end_matches(' ').to_string();
        }
        if line.is_empty() {
            continue;
        }
        if i != last {
            line.push(' ');
        }
        out.push_str(&line);
    }
    decode_entities(&out)
}

/// HTML entities as the JSX transform decodes them: named (a few), decimal and hex; None for another named one.
fn decode_entities(s: &str) -> Option<String> {
    let mut out = String::new();
    let mut rest = s;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        let after = &rest[at + 1..];
        let Some(end) = after.find(';').filter(|&e| e > 0 && after[..e].bytes().all(|b| b.is_ascii_alphanumeric() || b == b'#')) else {
            out.push('&');
            rest = after;
            continue;
        };
        let name = &after[..end];
        let decoded = if let Some(hex) = name.strip_prefix("#x").or_else(|| name.strip_prefix("#X")) {
            u32::from_str_radix(hex, 16).ok().and_then(char::from_u32).map(String::from)
        } else if let Some(dec) = name.strip_prefix('#') {
            dec.parse::<u32>().ok().and_then(char::from_u32).map(String::from)
        } else {
            match name {
                "amp" => Some("&".into()),
                "lt" => Some("<".into()),
                "gt" => Some(">".into()),
                "quot" => Some("\"".into()),
                "apos" => Some("'".into()),
                "nbsp" => Some("\u{a0}".into()),
                _ => return None,
            }
        };
        match decoded {
            Some(d) => out.push_str(&d),
            None => return None,
        }
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    Some(out)
}

/// Edits applied to `source`; an edit spanning others takes their results into its text. Insertions at one place keep
/// their order; wraps (start < end) contain the edits inside them.
fn apply(source: &str, edits: Vec<Edit>) -> String {
    let mut list: Vec<(usize, Edit)> = edits.into_iter().enumerate().collect();
    list.sort_by(|(i, a), (j, b)| a.start.cmp(&b.start).then(b.end.cmp(&a.end)).then(i.cmp(j)));
    let all: Vec<&(usize, Edit)> = list.iter().collect();
    build(source, 0, source.len() as u32, &all)
}

fn build(source: &str, from: u32, to: u32, list: &[&(usize, Edit)]) -> String {
    let mut out = String::new();
    let mut at = from;
    let mut k = 0;
    while k < list.len() {
        let (i, e) = list[k];
        if e.start < at {
            k += 1;
            continue;
        }
        out.push_str(&source[at as usize..e.start as usize]);
        if e.start == e.end {
            out.push_str(&e.text);
            at = e.start;
            k += 1;
            continue;
        }
        // Inner edits of this one, rebuilt into the text it wraps.
        let inner: Vec<&(usize, Edit)> = list
            .iter()
            .copied()
            .filter(|(j, x)| !(j == i) && x.start >= e.start && x.end <= e.end && !(x.start == e.start && x.end == e.end && j < i))
            .collect();
        let body = build(source, e.start, e.end, &inner);
        out.push_str(&e.text.replacen(&source[e.start as usize..e.end as usize], &body, 1));
        at = e.end;
        while k + 1 < list.len() && list[k + 1].1.start < e.end {
            k += 1;
        }
        k += 1;
    }
    out.push_str(&source[at as usize..to as usize]);
    out
}

#[cfg(test)]
mod tests {
    use super::compile;

    fn c(s: &str) -> String {
        compile(s, "a.tsx").unwrap()
    }

    #[test]
    fn dynamic_parts_are_marked() {
        let out = c("export function A(p) { return <Card class={p.c} onHit={p.h}>{count()} {x}</Card>; }");
        assert!(out.contains("class={__twist_d(() => (p.c))}"), "{out}");
        assert!(out.contains("onHit={__twist_d(() => (p.h))}"), "a component's onX is a prop: {out}");
        assert!(out.contains("{__twist_memo(() => (count()))}"), "one of several children: a memo: {out}");
        assert!(out.contains("{x}"), "{out}");
        assert!(out.contains("\nA = __twist_mark(A);"), "{out}");
        assert!(out.contains("import { __twist_d, __twist_c, __twist_ref, __twist_k, __twist_mark, __twist_memo } from \"@solidjs/web\";"), "{out}");
        // A component's prop with JSX in it: a getter (a function returning JSX stays as it is).
        let jsx = c("const B = () => <Loading fallback={<Spinner />} render={(e) => <i>{e}</i>} />;");
        assert!(jsx.contains("fallback={__twist_d(() => (<Spinner />))}"), "{jsx}");
        assert!(jsx.contains("render={(e) =>"), "{jsx}");
    }

    #[test]
    fn fixed_markup_becomes_templates() {
        let out = c("const A = () => <tr class={sel()}><td class=\"a\">{row.id}</td><td>Hi &amp; bye</td><Cell x={1} /></tr>;");
        assert!(out.contains(r#"__twist_t(["tr", [], ["class"], [["td", ["class", "a"], [], [0]], ["td", [], [], ["Hi & bye"]], 0]])"#), "{out}");
        assert!(out.contains("_tmpl$0([__twist_d(() => (sel())), __twist_d(() => (row.id)), <Cell x={1} />])"), "{out}");
        // Inside a component's children, in braces; SVG left as it is.
        let kids = c("const B = () => <Show when={x()}><p>{y()}</p><svg><path d=\"M0\" /></svg></Show>;");
        assert!(kids.contains("{_tmpl$0([__twist_d(() => (y()))])}"), "{kids}");
        assert!(kids.contains("<svg><path d=\"M0\" /></svg>"), "{kids}");
        // A static attribute after one set at run time: marked (the server keeps their order).
        let mixed = c("const C = () => <a class=\"x\" href={h()}>a</a>;");
        assert!(mixed.contains(r#"["a", ["class", "x"], ["href"], ["a"], 1]"#), "{mixed}");
    }

    #[test]
    fn hot_marks_name_components() {
        let out = super::compile_with("function A() { return <p />; }\nconst B = () => <i />;", "a.tsx", true).unwrap();
        assert!(out.contains("A = __twist_mark(A, \"A\");"), "{out}");
        assert!(out.contains("\"B\")"), "{out}");
    }

    #[test]
    fn conditions_with_jsx_are_memos() {
        let out = c("const A = () => <div>{s() > 5 && <p />}{t() ? <i /> : <b />}{u() && 'x'}</div>;");
        assert!(out.contains("__twist_d((() => { const _c$ = __twist_memo(() => (s() > 5)); return () => _c$() && _tmpl$"), "{out}");
        assert!(out.contains("const _c$ = __twist_memo(() => !!(t())); return () => _c$() ? _tmpl$"), "{out}");
        assert!(out.contains("__twist_d(() => (u() && 'x'))"), "{out}");
    }

    #[test]
    fn component_children_are_lazy_and_nested_edits_kept() {
        let out = c("const B = () => <Card>Hi {n()}</Card>;");
        assert!(out.contains("const B = __twist_mark(() => <Card>{__twist_c(() => <>Hi {__twist_memo(() => (n()))}</>)}</Card>);"), "{out}");
        let lone = c("const B = () => <For each={xs()}>{(x) => <i>{x}</i>}</For>;");
        assert!(!lone.contains("__twist_c("), "{lone}");
    }

    #[test]
    fn spreads_refs_and_statements() {
        let out = c("let el; function f() { <i ref={el} {...rest()} />; }");
        assert!(out.contains("ref={__twist_ref(el, (v) => (el = v))}"), "{out}");
        assert!(out.contains("{...{\"$spread$0\": () => (rest())}}"), "{out}");
        assert!(out.contains("__twist_k(<i"), "{out}");
        let kept = c("const el = 1; const x = <i ref={el} />;");
        assert!(kept.contains("_tmpl$0([el])"), "{kept}");
    }

    #[test]
    fn plain_files_and_errors() {
        assert_eq!(c("export const a = 1;"), "export const a = 1;");
        assert!(compile("const a = <b>1</c>;", "a.tsx").is_err());
        // A query on the file name is not its extension.
        assert!(compile("const A = () => <b>{a()}</b>;", "x/a.tsx?g=3").unwrap().contains("__twist_d"));
    }
}
