export interface ParsedArgs {
  cmd: string;
  flags: Record<string, any>;
  positionals: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [, , cmd, ...rest] = argv;
  const flags: Record<string, any> = {};
  const positionals: string[] = [];
  
  let i = 0;
  while (i < rest.length) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const [k, v] = a.includes("=") 
        ? a.split("=") 
        : [a, rest[i + 1] && !rest[i + 1].startsWith("-") ? rest[++i] : true];
      flags[k.slice(2)] = v === "true" ? true : v === "false" ? false : v;
    } else {
      positionals.push(a);
    }
    i++;
  }
  
  return { cmd, flags, positionals };
}


