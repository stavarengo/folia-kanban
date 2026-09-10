import { describe, it, expect } from "vitest";
import { buildBoard } from "../src/model/board";
import {
  drawnInColumn,
  drawnPaths,
  fallbackColumnOf,
  laneOf,
  laneRefusal,
  lanesOf,
  prospectiveCard,
  strandedLanePaths,
} from "../src/model/lanes";
import type { MatchContext } from "../src/model/filter";
import { BLOCKS } from "../src/model/relationships";
import type { BoardConfig, Card } from "../src/model/types";

const ctx: MatchContext = { today: "2026-09-10", doneColumnId: "done", relations: {} };

const base = {
  path: "Board.md",
  cardFolder: "Tasks",
  titleMode: "auto" as const,
  priorities: [],
  relations: [BLOCKS],
};

/** Todo (plain) · Research (a lane on `area:research`) · Done (plain). */
const laned: BoardConfig = {
  ...base,
  columns: [
    { id: "todo", title: "Todo" },
    { id: "research", title: "Research", filter: "area:research" },
    { id: "done", title: "Done" },
  ],
};

function card(basename: string, fm: Partial<Card["frontmatter"]> = {}): Card {
  return {
    path: `Tasks/${basename}.md`,
    basename,
    title: basename,
    titleSource: "filename",
    frontmatter: fm,
    childLinks: [],
  };
}

describe("what a column is", () => {
  it("reads a column with a rule as a lane and one without as plain", () => {
    const b = buildBoard(laned, []);
    expect(lanesOf(b).map((l) => l.columnId)).toEqual(["research"]);
    expect(laneOf(b, "research")?.rule).toBe("area:research");
    expect(laneOf(b, "todo")).toBeNull();
    expect(laneOf(b, "nosuchcolumn")).toBeNull();
  });

  it("falls back to the first column that is not itself a lane", () => {
    expect(fallbackColumnOf(buildBoard(laned, []))).toBe("todo");
    const laneFirst: BoardConfig = { ...base, columns: [laned.columns[1]!, laned.columns[0]!] };
    expect(fallbackColumnOf(buildBoard(laneFirst, []))).toBe("todo");
    const allLanes: BoardConfig = { ...base, columns: [laned.columns[1]!] };
    expect(fallbackColumnOf(buildBoard(allLanes, []))).toBeUndefined();
  });
});

describe("what a column draws", () => {
  it("pulls a lane's cards by its rule, from every bucket, ignoring its own", () => {
    const b = buildBoard(laned, [
      card("Elsewhere", { status: "todo", area: "research" }),
      card("Claiming", { status: "research", area: "home" }),
      card("Both", { status: "research", area: "research" }),
    ]);
    // Its own bucket holds Claiming and Both; the rule reaches Elsewhere and Both.
    expect([...b.columns["research"]!].sort()).toEqual(["Tasks/Both.md", "Tasks/Claiming.md"]);
    expect(drawnPaths(b, "research", ctx)).toEqual(["Tasks/Elsewhere.md", "Tasks/Both.md"]);
  });

  it("keeps a card drawn in a lane in its own status column too", () => {
    const b = buildBoard(laned, [card("Elsewhere", { status: "todo", area: "research" })]);
    expect(drawnPaths(b, "todo", ctx)).toContain("Tasks/Elsewhere.md");
    expect(drawnPaths(b, "research", ctx)).toContain("Tasks/Elsewhere.md");
  });

  it("gives the fallback column the cards no lane will draw", () => {
    const b = buildBoard(laned, [
      card("Stranded", { status: "research", area: "home" }),
      card("Drawn", { status: "research", area: "research" }),
      card("Plain", { status: "todo" }),
    ]);
    expect(strandedLanePaths(b, ctx)).toEqual(["Tasks/Stranded.md"]);
    expect(drawnPaths(b, "todo", ctx)).toEqual(["Tasks/Plain.md", "Tasks/Stranded.md"]);
    // The stranded card is not smuggled into every plain column, only the fallback one.
    expect(drawnPaths(b, "done", ctx)).toEqual([]);
    expect(drawnPaths(b, "research", ctx)).toEqual(["Tasks/Drawn.md"]);
  });

  it("has nowhere to put it when every column carries a rule", () => {
    const allLanes: BoardConfig = { ...base, columns: [laned.columns[1]!] };
    const b = buildBoard(allLanes, [card("Stranded", { status: "research", area: "home" })]);
    expect(strandedLanePaths(b, ctx)).toEqual(["Tasks/Stranded.md"]);
    expect(drawnPaths(b, "research", ctx)).toEqual([]);
  });
});

describe("which column a card is drawn in", () => {
  // Every lane pulls from every bucket, so the lane a card's status happens to name is not the only
  // one that can draw it. Asking only that lane would send a card the board plainly shows in Lane B
  // off to the fallback column.
  const twoLanes: BoardConfig = {
    ...base,
    columns: [
      { id: "todo", title: "Todo" },
      { id: "laneA", title: "Lane A", filter: "area:aaa" },
      { id: "laneB", title: "Lane B", filter: "area:bbb" },
    ],
  };

  it("names the lane that actually draws it, not the one its status names", () => {
    const b = buildBoard(twoLanes, [card("Cross", { status: "laneA", area: "bbb" })]);
    expect(drawnPaths(b, "laneB", ctx)).toEqual(["Tasks/Cross.md"]);
    expect(drawnInColumn(b, "laneA", "Tasks/Cross.md", ctx)).toBe("laneB");
  });

  it("names the fallback column when no lane will draw it", () => {
    const b = buildBoard(twoLanes, [card("Stray", { status: "laneA", area: "home" })]);
    expect(drawnInColumn(b, "laneA", "Tasks/Stray.md", ctx)).toBe("todo");
  });

  it("names a plain column as itself", () => {
    const b = buildBoard(twoLanes, [card("Plain", { status: "todo" })]);
    expect(drawnInColumn(b, "todo", "Tasks/Plain.md", ctx)).toBe("todo");
  });
});

describe("filing a card into a column", () => {
  const b = buildBoard(laned, [
    card("Match", { status: "todo", area: "research" }),
    card("Miss", { status: "todo", area: "home" }),
  ]);

  it("says nothing about a plain column, which owns whatever it is given", () => {
    expect(laneRefusal(b, "done", b.cards["Tasks/Miss.md"]!, ctx)).toBeNull();
  });

  it("says nothing about a lane the card matches", () => {
    expect(laneRefusal(b, "research", b.cards["Tasks/Match.md"]!, ctx)).toBeNull();
  });

  it("refuses a lane the card does not match, naming the rule and the card", () => {
    const why = laneRefusal(b, "research", b.cards["Tasks/Miss.md"]!, ctx);
    expect(why).toContain("area:research");
    expect(why).toContain("Research");
    expect(why).toContain("Miss");
  });

  it("does not refuse over a rule this context cannot evaluate", () => {
    // `unread:` is per reader and `assignee:me` is the Your-name setting; a context carrying
    // neither must not turn "I cannot tell" into "no".
    const perReader: BoardConfig = {
      ...base,
      columns: [
        { id: "todo", title: "Todo" },
        { id: "inbox", title: "Inbox", filter: "unread:comments" },
        { id: "mine", title: "Mine", filter: "assignee:me" },
      ],
    };
    const board = buildBoard(perReader, [card("Any", { status: "todo" })]);
    const any = board.cards["Tasks/Any.md"]!;
    expect(laneRefusal(board, "inbox", any, ctx)).toBeNull();
    expect(laneRefusal(board, "mine", any, ctx)).toBeNull();
    // Told who the reader is, the same rule does answer — and refuses.
    expect(laneRefusal(board, "mine", any, { ...ctx, me: "alex" })).toContain("assignee:me");
  });

  // The write sets `status`, and a rule may read exactly that. Judging the card as it stands today
  // answers about a card that will not exist once the move lands.
  it("judges the card as the move will leave it, not as it is now", () => {
    const byStatus: BoardConfig = {
      ...base,
      columns: [
        { id: "todo", title: "Todo" },
        { id: "queue", title: "Queue", filter: "status:queue" },
      ],
    };
    const board = buildBoard(byStatus, [card("X", { status: "todo" })]);
    // Reading the card as it stands, `status:queue` fails and the move would be refused — but the
    // move is what makes it true, and the lane draws the card the moment it lands.
    expect(laneRefusal(board, "queue", board.cards["Tasks/X.md"]!, ctx)).toBeNull();
  });

  it("does not wave through a move that its own status was the only reason to allow", () => {
    const byStatus: BoardConfig = {
      ...base,
      columns: [
        { id: "todo", title: "Todo" },
        { id: "queue", title: "Queue", filter: "status:todo" },
      ],
    };
    const board = buildBoard(byStatus, [card("X", { status: "todo" })]);
    // The card matches `status:todo` right now; moving it to Queue is what stops it matching.
    expect(laneRefusal(board, "queue", board.cards["Tasks/X.md"]!, ctx)).toContain("status:todo");
  });

  it("leaves a card alone when the lane's rule is one this caller cannot read", () => {
    const perReader: BoardConfig = {
      ...base,
      columns: [
        { id: "todo", title: "Todo" },
        { id: "inbox", title: "Inbox", filter: "unread:comments" },
      ],
    };
    const board = buildBoard(perReader, [card("Msg", { status: "inbox" })]);
    // Without a reader the rule cannot be judged, so the card is not declared stranded and not
    // moved to the fallback column on a guess — it stays listed under the lane its status names.
    expect(strandedLanePaths(board, ctx)).toEqual([]);
    expect(drawnPaths(board, "inbox", ctx)).toEqual(["Tasks/Msg.md"]);
    expect(drawnPaths(board, "todo", ctx)).toEqual([]);
  });

  it("judges a card that does not exist yet by what create_card would write", () => {
    expect(laneRefusal(b, "research", prospectiveCard("New", "research"), ctx)).toContain(
      "area:research",
    );
    // A rule the new card WILL satisfy is no reason to refuse: `status` is what createCard sets,
    // and `priority` is a field the call can carry.
    const byStatus: BoardConfig = {
      ...base,
      columns: [
        { id: "todo", title: "Todo" },
        { id: "urgent", title: "Urgent", filter: "priority:high" },
      ],
    };
    const board = buildBoard(byStatus, []);
    expect(laneRefusal(board, "urgent", prospectiveCard("New", "urgent"), ctx)).not.toBeNull();
    expect(
      laneRefusal(board, "urgent", prospectiveCard("New", "urgent", { priority: "high" }), ctx),
    ).toBeNull();
  });
});
