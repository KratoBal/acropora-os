/**
 * ACCEPTING A TICKET@ DRAFT (card ec7b947b, S2c): the pure choices. The ticket itself is made by the accept transaction in
 * `ServiceDraftsRepository`; a ticket exists only after a person accepts.
 */

/**
 * WHO OPENS THE TICKET. A KNOWN SENDER (the draft has `senderUserId`, looked up from a believed address) opens their own report as long as that
 * account is still active; every other draft (an unknown sender, a switched-off one with no account any more, a deactivated account) is opened
 * by the manager who accepts it. The reporter's name on the ticket is separate (`reporterPersonName`) and stays what the draft or the manager says.
 */
export function ticketJobOpener(input: {
  senderUserId: string | null;
  senderActive: boolean;
  actorUserId: string;
}): string {
  return input.senderUserId && input.senderActive
    ? input.senderUserId
    : input.actorUserId;
}

/**
 * WHICH OF A DRAFT'S ATTACHMENTS GO TO THE TICKET, AND AS WHAT: an image as a photo, a PDF as another document; anything else is not copied (the
 * intake keeps only PDF, JPEG and PNG by content, so this is the same set, decided once more at the point of copying).
 */
export function ticketAttachmentDocumentType(
  contentType: string,
): "PHOTO" | "OTHER" | null {
  const type = contentType.trim().toLowerCase();
  if (/^image\/(jpeg|jpg|png)$/.test(type)) return "PHOTO";
  if (type === "application/pdf") return "OTHER";
  return null;
}
