export type ParsedEntry = {
  nick: string;
  gameId: number;
  level: number | null;
};

export type ParseResult = {
  entries: ParsedEntry[];
  invalid: { line: number; text: string }[];
  totalLines: number;
};

const QUOTE = `["\u201C\u201D\u201E]`;

// Supported line formats (all produce nick + id + optional level):
//   1 "Nick" 7646467 1566560000 9999     (rank, nick, id, record, level)
//   "Nick" 7646467 9999                  (nick, id, level)
//   "Nick" 7646467                       (nick, id)
//   1 Nick 7646467 1566560000 9999       (no quotes, 5 columns)
const quoted = new RegExp(`^\\s*(?:\\d+\\s+)?${QUOTE}(.*)${QUOTE}\\s+((?:\\d+\\s*)+)$`);
const unquoted = /^\s*\d+\s+(.+?)\s+(\d+)\s+\d+\s+(\d+)\s*$/;

export function parseList(text: string): ParseResult {
  const lines = text.replace(/\r/g, "").split("\n");
  const entries: ParsedEntry[] = [];
  const invalid: { line: number; text: string }[] = [];
  let totalLines = 0;

  lines.forEach((raw, index) => {
    if (!raw.trim()) return;
    totalLines += 1;

    let nick: string | null = null;
    let gameId: number | null = null;
    let level: number | null = null;

    const q = raw.match(quoted);
    if (q) {
      const nums = q[2].trim().split(/\s+/);
      nick = q[1];
      gameId = Number(nums[0]);
      level = nums.length >= 2 ? Number(nums[nums.length - 1]) : null;
    } else {
      const u = raw.match(unquoted);
      if (u) {
        nick = u[1];
        gameId = Number(u[2]);
        level = Number(u[3]);
      }
    }

    if (
      nick === null ||
      nick.trim() === "" ||
      gameId === null ||
      !Number.isSafeInteger(gameId) ||
      gameId <= 0
    ) {
      invalid.push({ line: index + 1, text: raw.slice(0, 120) });
      return;
    }

    if (level !== null && (!Number.isSafeInteger(level) || level > 2147483647)) level = null;
    entries.push({ nick, gameId, level });
  });

  return { entries, invalid, totalLines };
}
