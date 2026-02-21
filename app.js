const SUPABASE_URL =
  window.APP_CONFIG?.supabaseUrl || "https://YOUR_PROJECT_ID.supabase.co";
const SUPABASE_ANON_KEY =
  window.APP_CONFIG?.supabaseAnonKey || "YOUR_SUPABASE_ANON_KEY";
const NOTIFICATION_EMAIL = window.APP_CONFIG?.notificationEmail || "";

const giftList = document.getElementById("gift-list");
const statusText = document.getElementById("status");
const modal = document.getElementById("participation-modal");
const form = document.getElementById("participation-form");
const selectedGiftText = document.getElementById("selected-gift");
const cancelBtn = document.getElementById("cancel-btn");

let selectedGift = null;
let gifts = [];
let supabaseClient = null;
const PUBLIC_SUPABASE_OPTIONS = {
  auth: {
    // La page publique n'utilise pas de session utilisateur.
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: "lisa-kdo-public",
    lockAcquireTimeout: 60000,
  },
};

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("error", isError);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getSortedPhotoUrls(gift) {
  const photos = Array.isArray(gift.gift_photos) ? gift.gift_photos : [];
  const sorted = [...photos].sort(
    (a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)
  );
  const urls = sorted.map((item) => item.photo_url).filter(Boolean);
  if (!urls.length && gift.photo_url) {
    urls.push(gift.photo_url);
  }
  return urls;
}

function renderGift(gift) {
  const safeDescription = gift.description || gift.note || "";
  const photoUrls = getSortedPhotoUrls(gift);
  const carouselId = `carousel-${gift.id}`;
  const photoBlock = photoUrls.length
    ? `
      <div class="gift-carousel" data-carousel-id="${carouselId}">
        <div class="gift-photo-strip" id="${carouselId}">${photoUrls
          .map(
            (url) =>
              `<img class="gift-photo" src="${escapeHtml(url)}" alt="${escapeHtml(gift.title)}" loading="lazy" />`
          )
          .join("")}</div>
        ${
          photoUrls.length > 1
            ? `
          <button type="button" class="carousel-btn prev" data-carousel-prev="${carouselId}" aria-label="Photo précédente">‹</button>
          <button type="button" class="carousel-btn next" data-carousel-next="${carouselId}" aria-label="Photo suivante">›</button>
        `
            : ""
        }
      </div>
    `
    : "";
  return `
    <article class="gift">
      ${photoBlock}
      <h3>${escapeHtml(gift.title)}</h3>
      <p class="price">Budget indicatif: ${gift.price} €</p>
      <p>${escapeHtml(safeDescription)}</p>
      <button type="button" data-gift-id="${gift.id}">Je participe</button>
    </article>
  `;
}

function isSupabaseConfigured() {
  return (
    SUPABASE_URL !== "https://YOUR_PROJECT_ID.supabase.co" &&
    SUPABASE_ANON_KEY !== "YOUR_SUPABASE_ANON_KEY"
  );
}

function hasNotificationEmail() {
  return Boolean(NOTIFICATION_EMAIL && NOTIFICATION_EMAIL.includes("@"));
}

async function sendParticipationEmail({
  giftTitle,
  contributorName,
  contributorEmail,
  amount,
  message,
}) {
  if (!hasNotificationEmail()) {
    return { sent: false, reason: "not_configured" };
  }

  const endpoint = `https://formsubmit.co/${encodeURIComponent(
    NOTIFICATION_EMAIL
  )}`;
  const payload = new FormData();
  payload.append("_subject", `Nouvelle participation: ${giftTitle}`);
  payload.append("_captcha", "false");
  payload.append("_template", "table");
  payload.append("cadeau", giftTitle);
  payload.append("nom", contributorName);
  payload.append("email", contributorEmail);
  payload.append("montant", `${amount} EUR`);
  payload.append("message", message || "-");

  const response = await Promise.race([
    fetch(endpoint, {
      method: "POST",
      body: payload,
      headers: { Accept: "application/json" },
    }),
    new Promise((_, reject) =>
      window.setTimeout(() => reject(new Error("mail_timeout")), 12000)
    ),
  ]);

  if (!response.ok) {
    throw new Error("mail_send_failed");
  }

  return { sent: true };
}

async function loadGifts() {
  // Fallback: supporte les bases qui n'ont pas encore la table gift_photos.
  let data = null;
  let error = null;

  const withPhotos = await supabaseClient
    .from("gifts")
    .select(
      "id, title, price, description, note, photo_url, gift_photos(photo_url, sort_order)"
    )
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (!withPhotos.error) {
    data = withPhotos.data;
  } else {
    const basic = await supabaseClient
      .from("gifts")
      .select("id, title, price, description, note, photo_url")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    data = basic.data;
    error = basic.error;
  }

  if (error) {
    throw error;
  }

  gifts = data || [];
  giftList.innerHTML = gifts.map(renderGift).join("");

  if (gifts.length === 0) {
    setStatus("Aucun cadeau n'est encore publié.", false);
  } else {
    setStatus("", false);
  }
}

giftList.addEventListener("click", (event) => {
  const prevBtn = event.target.closest("button[data-carousel-prev]");
  if (prevBtn) {
    const track = document.getElementById(prevBtn.dataset.carouselPrev);
    if (track) {
      track.scrollBy({ left: -track.clientWidth, behavior: "smooth" });
    }
    return;
  }

  const nextBtn = event.target.closest("button[data-carousel-next]");
  if (nextBtn) {
    const track = document.getElementById(nextBtn.dataset.carouselNext);
    if (track) {
      track.scrollBy({ left: track.clientWidth, behavior: "smooth" });
    }
    return;
  }

  const button = event.target.closest("button[data-gift-id]");
  if (!button) {
    return;
  }

  selectedGift = gifts.find((gift) => gift.id === button.dataset.giftId);
  if (!selectedGift) {
    return;
  }

  selectedGiftText.textContent = `Cadeau sélectionné: ${selectedGift.title}`;
  modal.showModal();
});

cancelBtn.addEventListener("click", () => {
  form.reset();
  modal.close();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!selectedGift || !supabaseClient) {
    return;
  }

  const formData = new FormData(form);
  const contributorName = String(formData.get("name") || "");
  const contributorEmail = String(formData.get("email") || "");
  const amount = Number(formData.get("amount"));
  const message = String(formData.get("message") || "");

  const { error } = await supabaseClient.from("participations").insert({
    gift_id: selectedGift.id,
    contributor_name: contributorName,
    contributor_email: contributorEmail,
    amount,
    message,
  });

  if (error) {
    alert("Erreur lors de l'enregistrement. Merci de réessayer.");
    return;
  }

  try {
    await sendParticipationEmail({
      giftTitle: selectedGift.title,
      contributorName,
      contributorEmail,
      amount,
      message,
    });
    alert("Merci! Ta participation a bien été enregistrée.");
  } catch (mailError) {
    alert(
      "Participation enregistrée, mais la notification email n'a pas pu être envoyée."
    );
  }
  form.reset();
  modal.close();
});

async function init() {
  if (!isSupabaseConfigured()) {
    setStatus(
      "Configuration Supabase manquante: complète config.js (supabaseUrl et supabaseAnonKey).",
      true
    );
    return;
  }

  supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    PUBLIC_SUPABASE_OPTIONS
  );

  try {
    await loadGifts();
  } catch (error) {
    const reason = error?.message ? ` (${error.message})` : "";
    setStatus(`Impossible de charger les cadeaux depuis Supabase${reason}.`, true);
  }
}

init();
