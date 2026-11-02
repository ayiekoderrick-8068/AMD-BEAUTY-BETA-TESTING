// Invitation message + WhatsApp click-to-chat link. Event date/venue appear only when the admin set them.
export function invitationMessage(guest, url, event = {}) {
  const firstName = (guest.name ?? "").trim().split(/\s+/)[0] || "there";
  const details = [
    event.when && `📅 ${event.when}`,
    event.venue && `📍 ${event.venue}`,
  ].filter(Boolean);
  return [
    `Hello ${firstName}!`,
    "",
    "You're invited to the AMD Beauty Product Launch!",
    "",
    "We're excited to have you join us for an exclusive beauty experience, product showcase, and live audience poll.",
    ...(details.length ? ["", ...details] : []),
    "",
    "Your personal invitation link:",
    url,
    "",
    "Please keep this invitation handy for event check-in.",
    "",
    "We look forward to seeing you!",
    "",
    "— AMD Beauty Team",
  ].join("\n");
}

// With a phone number WhatsApp opens that chat; without one it asks who to send to.
// Either way the message is only prefilled: the admin still presses Send.
export function whatsappUrl(phone, message) {
  const digits = (phone ?? "").replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false; // Clipboard blocked (e.g. not HTTPS): caller shows the link to copy by hand.
  }
}
