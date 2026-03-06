use oxc::allocator::Allocator;
use oxc::cfg::ControlFlowGraph;
use oxc::cfg::DisplayDot;
use oxc::parser::Parser;
use oxc::semantic::SemanticBuilder;
use oxc::span::SourceType;
use std::fs;
use std::path::Path;

fn main() {
    let unsec_dir = Path::new("unsec");
    let source_path = unsec_dir.join("basecode.ts");
    let source_text =
        fs::read_to_string(&source_path).unwrap_or_else(|e| panic!("read {}: {}", source_path.display(), e));

    let allocator = Allocator::default();
    let source_type = SourceType::ts();
    let parser_ret = Parser::new(&allocator, &source_text, source_type).parse();
    let program = &parser_ret.program;

    let build_ret = SemanticBuilder::new()
        .with_cfg(true)
        .build(program);
    let semantic = &build_ret.semantic;

    let cfg: Option<&ControlFlowGraph> = semantic.cfg();
    match cfg {
        Some(cfg) => {
            println!("CFG from {} ({} basic blocks):", source_path.display(), cfg.basic_blocks.len());
            println!("{}", cfg.display_dot());
        }
        None => println!("No CFG (semantic build did not produce one)."),
    }
}
