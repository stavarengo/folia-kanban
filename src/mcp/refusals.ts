// What a write tool refuses to put into a note, and the words it refuses with.
//
// Each of these is a shape that would stop being the thing the caller sent once the note is parsed
// back: a description that opens one of the board's own sections, an entry that mints a second
// Markdown line, a signature the comment prefix cannot carry. The judgement itself is the model's
// (`descriptionRefusal`, `authorRefusal`); what lives here is saying so in terms the caller can act
// on — which is the layer's job, and keeps the tool definitions about the writes they perform.

import { descriptionRefusal } from "../model/card";
import { authorRefusal, normalizeAuthor } from "../model/unread";
import { ToolError } from "./tool";

/**
 * A description the plugin would read back as something other than a description is refused, using
 * the same judgement the detail panel makes before it saves one.
 *
 * `setDescription` splices the text in verbatim, so a line reading `## History` inside it does not
 * stay text: the note is parsed back and that heading starts the real History section. An agent
 * could write its own audit trail, and sign a comment with the user's name, through the one tool
 * whose whole purpose is that writes are accountable. The description also silently loses
 * everything below the injected heading, so the call reports success over text that is largely
 * gone. The panel refuses this and says why; so does this.
 */
export function refuseUnsafeDescription(description: string): void {
  const refusal = descriptionRefusal(description);
  if (refusal === null) return;
  if (refusal.kind === "heading") {
    throw new ToolError(
      `That description contains "${refusal.line}", which starts a section the board owns. The note would read it as that section rather than as description, and everything after it would stop being description at all. Use add_comment for a comment; history is the board's to write.`,
    );
  }
  if (refusal.kind === "title") {
    throw new ToolError(
      `That description opens with "${refusal.line}", and a card reads its title from the first \`#\` heading. The line would be taken as the title rather than kept as description, and it would not come back. Use \`##\` or lower, or set the title with update_card's own \`title\` field.`,
    );
  }
  throw new ToolError(
    `That description leaves a code fence open ("${refusal.line}"). Everything after it in the note, the board's own sections included, would be swallowed by the fence. Close it and try again.`,
  );
}

/**
 * Text that becomes one Markdown list item has to stay one line.
 *
 * A subtask and a comment are each written as a single `- …` line. A newline in the middle of one
 * is not a longer entry — it is raw Markdown spliced into the note: a second checklist line the
 * caller did not ask for, or a `## History` heading that opens the real section and lets an agent
 * write the record that is supposed to be about it. The panel's subtask control is a one-line
 * input, so this is the first caller that could send a newline at all.
 *
 * What this does not do, and is not meant to, is police what one line may say. A single-line
 * subtask carrying a `[status:: done]` claim promotes itself to a card on the board — and typing
 * exactly that into the panel does the same thing. The tools are meant to be as capable as a
 * person, not more careful than one; it is the forging of the board's own record that is out of
 * bounds.
 */
export function refuseMultilineEntry(what: "subtask" | "comment", text: string): void {
  if (!/[\r\n]/.test(text)) return;
  throw new ToolError(
    `A ${what} is written as a single line, so its text cannot contain a line break — spliced into the note, the second line would be read as Markdown of its own rather than as part of what you wrote. Send it as one line${what === "comment" ? ", or as several comments" : ""}.`,
  );
}

/**
 * A comment's signature has to reach the line's author prefix (`- _<ts> @name:_ …`) unchanged: a
 * name the prefix cannot hold would be rewritten on the way in, and `Ana Maria` attributed to
 * `Ana-Maria` is a different person to `assignee`, which keeps its spaces. `authorRefusal` makes
 * the judgement; this says it in the caller's terms, naming the shape that would have worked.
 */
export function refuseAuthor(author: string): void {
  const refusal = authorRefusal(author);
  if (refusal === null) return;
  throw new ToolError(
    refusal === "empty"
      ? "A comment is signed with the name of whoever writes it, so `author` cannot be empty. Send your own name, not the user's."
      : `"${author}" cannot sign a comment: the signature sits inside \`- _<time> @name:_\`, so it cannot carry whitespace, \`:\`, \`@\`, \`*\`, a backtick or square brackets. Send it as one word — \`${normalizeAuthor(author) || "your-name"}\` is the same name in a shape the line can hold.`,
  );
}
