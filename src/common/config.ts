import { createToken, Lexer, CstParser, EOF, CstNode, IToken, CstElement } from 'chevrotain';
import { readFile } from "fs/promises";

enum LexedToken {
	ROLE = "role",
	DEFAULT = "default",
	HIERARCHY = "hierarchy",
	LPAREN = "lparen",
	RPAREN = "rparen",
	COMMA = "comma",
	LT = "lt",
	GT = "gt",
	NEWLINE = "newline",
	EOF = "eof",
	WHITESPACE = "whitespace",
	IDENTIFIER = "identifier",
	COMMENT = "comment",
	MULTILINECOMMENT = "multilinecomment"
}

const TRole = createToken({ name: LexedToken.ROLE, pattern: /@role/ });
const TDefault = createToken({ name: LexedToken.DEFAULT, pattern: /@default/ });
const THierarchy = createToken({ name: LexedToken.HIERARCHY, pattern: /@hierarchy/ });
const TLParen = createToken({ name: LexedToken.LPAREN, pattern: /\(/ });
const TRParen = createToken({ name: LexedToken.RPAREN, pattern: /\)/ });
const TComma = createToken({ name: LexedToken.COMMA, pattern: /\,/ });
const TLT = createToken({ name: LexedToken.LT, pattern: /\</ });
const TGT = createToken({ name: LexedToken.GT, pattern: /\>/ });
const TNewline = createToken({ name: LexedToken.NEWLINE, pattern: /(\n|\r\n)/ })
const TEOF = createToken({ name: LexedToken.EOF, pattern: EOF.PATTERN })
const TWhitespace = createToken({ name: LexedToken.WHITESPACE, pattern: /[^\S\r\n]/, group: Lexer.SKIPPED });
const TComment = createToken({ name: LexedToken.COMMENT, pattern: /\/\/.*/, group: Lexer.SKIPPED });
const TMultilineComment = createToken({ name: LexedToken.MULTILINECOMMENT, pattern: /\/\*[\s\S]*?\*\//, group: Lexer.SKIPPED })
const TIdentifier = createToken({ name: LexedToken.IDENTIFIER, pattern: /\w+/ });

const Tokens = [
	TRole,
	TDefault,
	THierarchy,
	TRParen,
	TLParen,
	TComma,
	TLT,
	TGT,
	TNewline,
	TEOF,
	TWhitespace,
	TIdentifier,
	TComment,
	TMultilineComment
];

enum ParsedToken {
	DEFAULT = "create-default",
	ROLE = "create-role",
	CONFIG = "config",
	HIERARCHY = "create-hierarchy",
	NEXT = "next"
};

class DespotLang extends CstParser {
	constructor() {
		super(Tokens);
		this.performSelfAnalysis();
	}
	private DefineRole = this.RULE(ParsedToken.ROLE, () => {
		this.CONSUME(TRole);
		this.CONSUME1(TIdentifier);
		this.OPTION(() => {
			this.CONSUME(TLParen);
			this.MANY_SEP({
				SEP: TComma, DEF: () => {
					this.CONSUME2(TIdentifier);
				}
			});
			this.CONSUME(TRParen);
		});
	});
	private DefineDefault = this.RULE(ParsedToken.DEFAULT, () => {
		this.CONSUME(TDefault);
		this.CONSUME(TIdentifier);
	});
	private Hierarchy = this.RULE(ParsedToken.HIERARCHY, () => {
		this.CONSUME(THierarchy);
		this.CONSUME1(TIdentifier);
		this.OR([
			{
				GATE: () => this.LA(1).tokenType === TLT,
				ALT: () => {
					this.MANY1(() => {
						this.CONSUME(TLT)
						this.CONSUME2(TIdentifier)
					});
				}
			},
			{
				GATE: () => this.LA(1).tokenType === TGT,
				ALT: () => {
					this.MANY2(() => {
						this.CONSUME(TGT)
						this.CONSUME3(TIdentifier)
					});
				}
			}
		]);
	});
	private NextExp = this.RULE(ParsedToken.NEXT, () => {
		this.OR([
			{ ALT: () => this.CONSUME(TNewline) },
			{ ALT: () => this.CONSUME(TEOF) }
		]);
	});
	public Config = this.RULE(ParsedToken.CONFIG, () => {
		this.AT_LEAST_ONE(() => {
			this.MANY_SEP({
				SEP: () => this.SUBRULE(this.NextExp),
				DEF: () => this.OR([
					{ ALT: () => this.SUBRULE(this.DefineRole) },
					{ ALT: () => this.SUBRULE(this.DefineDefault) },
					{ ALT: () => this.SUBRULE(this.Hierarchy) },
					{ ALT: () => this.SUBRULE(this.NextExp) },
				])
			});
		});
	});
}

interface Roles {
	[key: string]: {
		subsumes: string[];
	}
}

interface Config {
	roles: Roles;
	defaultRole: string;
}

function castNode(node: CstElement, cast: ParsedToken): CstNode {
	const roleNode = node as CstNode;
	if (roleNode.name === cast) return roleNode;
	throw new Error(`Failed casting ${JSON.stringify(node)} to ${cast}`);
}
function getChildToken(node: CstNode, search: LexedToken, index: number = 0): IToken {
	if (!node.children[search]) throw new Error(`Node ${node.name} has no child ${search}`);
	const len = node.children[search].length;
	if (index >= len) throw new Error(`Index ${index} out of bounds: ${node.name} has ${len} children of type ${search}`)
	return node.children[search][index] as IToken;
}

enum Traversal {
	VISITING,
	VISITED
};
function updateHierarchy(graph: Roles, source: string, dest: string) {
	graph[source].subsumes.push(dest);

	const seen: Record<string, Traversal> = {};

	function dfs(node: string) {
		if (seen[node] === Traversal.VISITING) return false;
		if (seen[node] === Traversal.VISITED) return true;
		seen[node] = Traversal.VISITING;
		for (const subsumed of graph[node].subsumes) {
			if (!dfs(subsumed)) return false;
		}
		seen[node] = Traversal.VISITED;
		return true;
	}

	for (const node of Object.keys(graph)) {
		if (!seen[node] && !dfs(node)) {
			graph[source].subsumes.pop();
			throw new Error(`Cannot add edge from ${source} to ${dest} -- this would create a cycle which is bad`);
		}
	}
}

function interpret(config: CstNode) {
	const tokenType = config.name as ParsedToken;

	if (tokenType !== ParsedToken.CONFIG) {
		throw new Error(`Can only interpret a top-level ${ParsedToken.CONFIG} parsed token`);
	}

	const parsed: Config = {
		roles: {},
		defaultRole: ""
	};

	for (const role of config.children[ParsedToken.ROLE]) {
		const roleNode = castNode(role, ParsedToken.ROLE);
		const identifier = getChildToken(roleNode, LexedToken.IDENTIFIER).image;
		if (parsed.roles[identifier]) throw new Error(`Duplicate role ${identifier}`);
		parsed.roles[identifier] = {
			subsumes: []
		};
	}
	for (const defaultRole of config.children[ParsedToken.DEFAULT]) {
		const roleNode = castNode(defaultRole, ParsedToken.DEFAULT);
		const identifier = getChildToken(roleNode, LexedToken.IDENTIFIER).image;
		if (parsed.roles[identifier]) throw new Error(`Role ${identifier} defined in both @role and @default -- pick one`);
		if (parsed.defaultRole !== "") throw new Error(`@default specified more than once -- can only have one default role`);
		parsed.defaultRole = identifier;
		parsed.roles[identifier] = {
			subsumes: []
		};
	}
	for (const hierarchy of config.children[ParsedToken.HIERARCHY]) {
		const hierarchyNode = castNode(hierarchy, ParsedToken.HIERARCHY);
		let operator: IToken;
		try {
			operator = getChildToken(hierarchyNode, LexedToken.LT);
		} catch {
			try {
				operator = getChildToken(hierarchyNode, LexedToken.GT);
			} catch {
				throw new Error(`@hierarchy has no ${LexedToken.LT} or ${LexedToken.GT} operator, how did this happen?`);
			}
		}
		const numIdentifiers = hierarchyNode.children[LexedToken.IDENTIFIER]?.length;
		if (!numIdentifiers || numIdentifiers < 2) throw new Error(`@hierarchy has too few identifiers`);
		for (let i = 0; i < numIdentifiers - 1; i++) {
			let curr = getChildToken(hierarchyNode, LexedToken.IDENTIFIER, i).image;
			let next = getChildToken(hierarchyNode, LexedToken.IDENTIFIER, i + 1).image;
			if (curr === parsed.defaultRole || next === parsed.defaultRole) throw Error(`Do not include the default role ${parsed.defaultRole} in a ${LexedToken.HIERARCHY} statement, it will already exist as the lowest privilege role`);
			if (!parsed.roles[curr]) throw new Error(`Role ${curr} in ${LexedToken.HIERARCHY} has no corresponding @role declaration`);
			if (!parsed.roles[next]) throw new Error(`Role ${next} in ${LexedToken.HIERARCHY} has no corresponding @role declaration`);
			if (curr === next) throw new Error(`Role ${next} in ${LexedToken.HIERARCHY} cannot subsume itself!`);
			switch (operator.tokenType.name) {
				case LexedToken.LT:
					// curr < next
					// next should subsume curr, so make an edge from next -> curr
					updateHierarchy(parsed.roles, next, curr);
					break;
				case LexedToken.GT:
					// curr > next
					// curr should subsume next, so make an edge from curr -> next
					updateHierarchy(parsed.roles, curr, next);
					break;
			}
		}
	}
	return parsed;
}

const lexer = new Lexer(Tokens);
const parser = new DespotLang();

export async function readRoleConfig(path: string): Promise<Config> {
	const raw = await readFile(path, { encoding: "utf-8" });
	const lexed = lexer.tokenize(raw).tokens;
	parser.input = lexed;
	const parsed = parser.Config();
	const interpreted = interpret(parsed);
	return interpreted;
}