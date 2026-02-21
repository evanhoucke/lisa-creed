const SUPABASE_URL =
  window.APP_CONFIG?.supabaseUrl || "https://YOUR_PROJECT_ID.supabase.co";
const SUPABASE_ANON_KEY =
  window.APP_CONFIG?.supabaseAnonKey || "YOUR_SUPABASE_ANON_KEY";

const statusText = document.getElementById("admin-status");
const authSection = document.getElementById("auth-section");
const dashboardSection = document.getElementById("dashboard-section");
const loginForm = document.getElementById("login-form");
const logoutBtn = document.getElementById("logout-btn");
const giftForm = document.getElementById("gift-form");
const giftFormTitle = document.getElementById("gift-form-title");
const giftSubmitBtn = document.getElementById("gift-submit-btn");
const giftCancelEditBtn = document.getElementById("gift-cancel-edit-btn");
const giftPhotoHelp = document.getElementById("gift-photo-help");
const existingPhotosWrap = document.getElementById("existing-photos-wrap");
const existingPhotos = document.getElementById("existing-photos");
const adminGiftList = document.getElementById("admin-gift-list");
const summary = document.getElementById("summary");
const participationsBody = document.getElementById("participations-body");

let supabaseClient = null;
let adminGifts = [];
let editingGiftId = null;
let saveWatchdogId = null;
const ADMIN_SUPABASE_OPTIONS = {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: "lisa-kdo-admin-auth",
    lockAcquireTimeout: 60000,
  },
};

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("error", isError);
}

function isSupabaseConfigured() {
  return (
    SUPABASE_URL !== "https://YOUR_PROJECT_ID.supabase.co" &&
    SUPABASE_ANON_KEY !== "YOUR_SUPABASE_ANON_KEY"
  );
}

function showDashboard(show) {
  authSection.classList.toggle("hidden", show);
  dashboardSection.classList.toggle("hidden", !show);
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleString("fr-BE", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function formatAmount(amount) {
  return `${Number(amount).toFixed(2)} EUR`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getErrorMessage(error) {
  if (!error) {
    return "Erreur inconnue";
  }
  if (typeof error === "string") {
    return error;
  }
  if (error.message) {
    return error.message;
  }
  if (error.error_description) {
    return error.error_description;
  }
  return "Erreur inconnue";
}

async function withTimeout(promise, label, timeoutMs = 60000) {
  let timeoutId = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error(`${label}: délai dépassé (${timeoutMs / 1000}s)`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
}

function startSaveWatchdog(timeoutMs = 90000) {
  stopSaveWatchdog();
  saveWatchdogId = window.setTimeout(() => {
    giftSubmitBtn.disabled = false;
    setStatus(
      "Opération bloquée trop longtemps. Vérifie Network/Console puis réessaie.",
      true
    );
  }, timeoutMs);
}

function stopSaveWatchdog() {
  if (saveWatchdogId !== null) {
    window.clearTimeout(saveWatchdogId);
    saveWatchdogId = null;
  }
}

function getSortedPhotos(gift) {
  const photos = Array.isArray(gift.gift_photos) ? gift.gift_photos : [];
  return [...photos].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
}

function getFirstPhotoUrl(gift) {
  const photos = getSortedPhotos(gift);
  if (photos.length > 0) {
    return photos[0].photo_url;
  }
  return gift.photo_url || "";
}

function renderExistingPhotos(gift) {
  const photos = getSortedPhotos(gift);
  if (!photos.length) {
    existingPhotosWrap.classList.add("hidden");
    existingPhotos.innerHTML = "";
    return;
  }

  existingPhotosWrap.classList.remove("hidden");
  existingPhotos.innerHTML = photos
    .map(
      (photo) => `
        <article class="existing-photo-item">
          <img src="${escapeHtml(photo.photo_url)}" alt="Photo cadeau" />
          <button type="button" class="danger" data-action="remove-photo" data-photo-id="${photo.id}">
            Supprimer la photo
          </button>
        </article>
      `
    )
    .join("");
}

function setGiftFormMode(isEdit) {
  if (isEdit) {
    giftFormTitle.textContent = "Modifier un cadeau";
    giftSubmitBtn.textContent = "Enregistrer les modifications";
    giftCancelEditBtn.classList.remove("hidden");
    giftPhotoHelp.textContent = "Optionnel: ajoute une ou plusieurs nouvelles photos.";
  } else {
    giftFormTitle.textContent = "Ajouter un cadeau";
    giftSubmitBtn.textContent = "Ajouter le cadeau";
    giftCancelEditBtn.classList.add("hidden");
    giftPhotoHelp.textContent = "Au moins une photo requise pour un nouveau cadeau.";
  }
}

function resetGiftForm() {
  giftForm.reset();
  giftForm.elements.gift_id.value = "";
  editingGiftId = null;
  existingPhotosWrap.classList.add("hidden");
  existingPhotos.innerHTML = "";
  setGiftFormMode(false);
}

function startEditGift(giftId) {
  const gift = adminGifts.find((item) => item.id === giftId);
  if (!gift) {
    setStatus("Cadeau introuvable.", true);
    return;
  }

  editingGiftId = gift.id;
  giftForm.elements.gift_id.value = gift.id;
  giftForm.elements.title.value = gift.title || "";
  giftForm.elements.description.value = gift.description || gift.note || "";
  giftForm.elements.price.value = Number(gift.price).toFixed(2);
  renderExistingPhotos(gift);
  setGiftFormMode(true);
  giftForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderSummary(participations) {
  const totalCount = participations.length;
  const totalAmount = participations.reduce(
    (acc, item) => acc + Number(item.amount),
    0
  );

  summary.innerHTML = `
    <article class="card summary-card">
      <h3>Total participations</h3>
      <p>${totalCount}</p>
    </article>
    <article class="card summary-card">
      <h3>Montant total</h3>
      <p>${formatAmount(totalAmount)}</p>
    </article>
  `;
}

function renderParticipations(participations) {
  participationsBody.innerHTML = participations
    .map((item) => {
      const giftName = item.gifts?.title || "Cadeau supprimé";
      const message = item.message ? item.message : "-";
      return `
        <tr>
          <td>${formatDate(item.created_at)}</td>
          <td>${escapeHtml(giftName)}</td>
          <td>${escapeHtml(item.contributor_name)}</td>
          <td>${escapeHtml(item.contributor_email)}</td>
          <td>${formatAmount(item.amount)}</td>
          <td>${escapeHtml(message)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderAdminGifts(gifts) {
  if (!gifts.length) {
    adminGiftList.innerHTML = "<p>Aucun cadeau pour le moment.</p>";
    return;
  }

  adminGiftList.innerHTML = gifts
    .map((gift) => {
      const coverPhotoUrl = getFirstPhotoUrl(gift);
      const photoBlock = coverPhotoUrl
        ? `<img src="${escapeHtml(coverPhotoUrl)}" alt="${escapeHtml(gift.title)}" />`
        : "";
      const description = gift.description || gift.note || "";
      const state = gift.is_active ? "Actif" : "Masqué";
      const photoCount = getSortedPhotos(gift).length || (gift.photo_url ? 1 : 0);

      return `
        <article class="gift admin-gift-item">
          ${photoBlock}
          <h4>${escapeHtml(gift.title)}</h4>
          <p class="price">${formatAmount(gift.price)}</p>
          <p>${escapeHtml(description)}</p>
          <p class="small-note">Statut: ${state} | Photos: ${photoCount}</p>
          <div class="inline-actions">
            <button type="button" data-action="edit" data-gift-id="${gift.id}">Modifier</button>
            <button type="button" class="danger" data-action="delete" data-gift-id="${gift.id}">Supprimer</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function clearDashboard() {
  summary.innerHTML = "";
  participationsBody.innerHTML = "";
  adminGiftList.innerHTML = "";
}

async function loadDashboard() {
  const { data, error } = await supabaseClient
    .from("participations")
    .select(
      "id, contributor_name, contributor_email, amount, message, created_at, gifts(title)"
    )
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  renderSummary(data || []);
  renderParticipations(data || []);
}

async function loadAdminGifts() {
  let data = null;
  let error = null;

  const withPhotos = await supabaseClient
    .from("gifts")
    .select(
      "id, title, price, description, note, photo_url, is_active, gift_photos(id, photo_url, sort_order)"
    )
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (!withPhotos.error) {
    data = withPhotos.data;
  } else {
    const basic = await supabaseClient
      .from("gifts")
      .select("id, title, price, description, note, photo_url, is_active")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    data = basic.data;
    error = basic.error;
  }

  if (error) {
    throw error;
  }

  adminGifts = data || [];
  renderAdminGifts(adminGifts);

  if (editingGiftId) {
    const refreshedGift = adminGifts.find((gift) => gift.id === editingGiftId);
    if (refreshedGift) {
      renderExistingPhotos(refreshedGift);
    }
  }
}

function getStoragePathFromPublicUrl(publicUrl) {
  const marker = "/storage/v1/object/public/gift-photos/";
  const index = publicUrl.indexOf(marker);
  if (index === -1) {
    return null;
  }

  const pathWithQuery = publicUrl.slice(index + marker.length);
  return decodeURIComponent(pathWithQuery.split("?")[0]);
}

async function uploadGiftPhotos(files) {
  const urls = [];

  for (const file of files) {
    const filename = file.name || "photo.jpg";
    const extension = filename.includes(".")
      ? filename.split(".").pop().toLowerCase()
      : "jpg";
    const filePath = `${Date.now()}-${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await supabaseClient.storage
      .from("gift-photos")
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      throw uploadError;
    }

    const { data } = supabaseClient.storage
      .from("gift-photos")
      .getPublicUrl(filePath);

    urls.push(data.publicUrl);
  }

  return urls;
}

async function insertGiftPhotos(giftId, photoUrls) {
  if (!photoUrls.length) {
    return;
  }

  const { data: maxRow, error: maxError } = await supabaseClient
    .from("gift_photos")
    .select("sort_order")
    .eq("gift_id", giftId)
    .order("sort_order", { ascending: false })
    .limit(1);

  if (maxError) {
    throw maxError;
  }

  const startSort = maxRow && maxRow.length ? Number(maxRow[0].sort_order || 0) + 1 : 1;

  const rows = photoUrls.map((photoUrl, index) => ({
    gift_id: giftId,
    photo_url: photoUrl,
    sort_order: startSort + index,
  }));

  const { error } = await supabaseClient.from("gift_photos").insert(rows);
  if (error) {
    throw error;
  }
}

async function syncGiftCoverPhoto(giftId) {
  const { data, error } = await supabaseClient
    .from("gift_photos")
    .select("photo_url")
    .eq("gift_id", giftId)
    .order("sort_order", { ascending: true })
    .limit(1);

  if (error) {
    throw error;
  }

  const coverUrl = data && data.length ? data[0].photo_url : null;
  const { error: updateError } = await supabaseClient
    .from("gifts")
    .update({ photo_url: coverUrl })
    .eq("id", giftId);

  if (updateError) {
    throw updateError;
  }
}

async function getGiftPhotoRows(giftId) {
  const { data, error } = await supabaseClient
    .from("gift_photos")
    .select("id, photo_url")
    .eq("gift_id", giftId);

  if (error) {
    throw error;
  }

  return data || [];
}

async function deleteGift(giftId) {
  const gift = adminGifts.find((item) => item.id === giftId);
  if (!gift) {
    setStatus("Cadeau introuvable.", true);
    return;
  }

  const confirmed = window.confirm(
    `Supprimer le cadeau \"${gift.title}\" ? Cette action est définitive.`
  );
  if (!confirmed) {
    return;
  }

  setStatus("Suppression du cadeau en cours...");

  const { error } = await supabaseClient.from("gifts").delete().eq("id", giftId);

  if (!error) {
    if (editingGiftId === giftId) {
      resetGiftForm();
    }
    await loadAdminGifts();
    setStatus("Cadeau supprimé.");
    return;
  }

  const { error: hideError } = await supabaseClient
    .from("gifts")
    .update({ is_active: false })
    .eq("id", giftId);

  if (hideError) {
    setStatus("Impossible de supprimer ce cadeau.", true);
    return;
  }

  if (editingGiftId === giftId) {
    resetGiftForm();
  }
  await loadAdminGifts();
  setStatus("Ce cadeau a des participations: il a été masqué au lieu d'être supprimé.");
}

async function removePhoto(photoId) {
  if (!editingGiftId) {
    return;
  }

  const confirmed = window.confirm("Supprimer cette photo ?");
  if (!confirmed) {
    return;
  }

  setStatus("Suppression de la photo en cours...");

  const { data: row, error: fetchError } = await supabaseClient
    .from("gift_photos")
    .select("photo_url")
    .eq("id", photoId)
    .single();

  if (fetchError) {
    setStatus("Impossible de trouver la photo.", true);
    return;
  }

  const { error: deleteError } = await supabaseClient
    .from("gift_photos")
    .delete()
    .eq("id", photoId);

  if (deleteError) {
    setStatus("Impossible de supprimer cette photo.", true);
    return;
  }

  const storagePath = row?.photo_url ? getStoragePathFromPublicUrl(row.photo_url) : null;
  if (storagePath) {
    await supabaseClient.storage.from("gift-photos").remove([storagePath]);
  }

  await syncGiftCoverPhoto(editingGiftId);
  await loadAdminGifts();
  setStatus("Photo supprimée.");
}

async function refreshSessionUi() {
  const {
    data: { session },
  } = await supabaseClient.auth.getSession();

  if (!session) {
    showDashboard(false);
    clearDashboard();
    resetGiftForm();
    setStatus("Connecte-toi pour afficher les participations.");
    return;
  }

  showDashboard(true);
  setStatus("");
  try {
    await Promise.all([loadDashboard(), loadAdminGifts()]);
  } catch (error) {
    setStatus("Impossible de charger les données admin.", true);
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(loginForm);
  const email = String(formData.get("email") || "");
  const password = String(formData.get("password") || "");

  setStatus("Connexion en cours...");
  const { error } = await supabaseClient.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    setStatus("Connexion refusée. Vérifie ton email et ton mot de passe.", true);
    return;
  }

  loginForm.reset();
  await refreshSessionUi();
});

giftForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(giftForm);
  const giftId = String(formData.get("gift_id") || "");
  const isEdit = Boolean(giftId);
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const price = Number(formData.get("price"));
  const files = giftForm.elements.photos.files;
  const newPhotos = files ? Array.from(files).filter((file) => file.size > 0) : [];

  if (!title || !description || Number.isNaN(price) || price < 0) {
    setStatus("Vérifie les champs du cadeau (nom, description, prix).", true);
    return;
  }

  if (!isEdit && newPhotos.length === 0) {
    setStatus("Ajoute au moins une photo avant de valider le cadeau.", true);
    return;
  }

  giftSubmitBtn.disabled = true;
  setStatus(isEdit ? "Modification du cadeau en cours..." : "Ajout du cadeau en cours...");
  startSaveWatchdog();

  try {
    const payload = {
      title,
      description,
      note: description,
      price,
    };

    if (isEdit) {
      setStatus("Mise à jour du cadeau...");
      const { error } = await withTimeout(
        supabaseClient.from("gifts").upsert(
          {
            id: giftId,
            ...payload,
          },
          { onConflict: "id" }
        ),
        "Mise à jour cadeau",
        60000
      );

      if (error) {
        throw error;
      }

      if (newPhotos.length > 0) {
        setStatus("Upload des nouvelles photos...");
        const photoUrls = await withTimeout(
          uploadGiftPhotos(newPhotos),
          "Upload photos",
          90000
        );
        await withTimeout(
          insertGiftPhotos(giftId, photoUrls),
          "Enregistrement des photos"
        );
      }

      await withTimeout(syncGiftCoverPhoto(giftId), "Mise à jour photo principale");
      setStatus("Rechargement des cadeaux...");
      await withTimeout(loadAdminGifts(), "Rechargement des cadeaux");
      setStatus("Cadeau modifié avec succès.");
      resetGiftForm();
    } else {
      setStatus("Création du cadeau...");
      const { data: insertedGift, error: insertError } = await withTimeout(
        supabaseClient
          .from("gifts")
          .insert({
            ...payload,
            is_active: true,
            sort_order: 1,
          })
          .select("id")
          .single(),
        "Insertion cadeau"
        ,
        60000
      );

      if (insertError || !insertedGift) {
        throw insertError || new Error("insert_failed");
      }

      setStatus("Upload des photos...");
      const photoUrls = await withTimeout(
        uploadGiftPhotos(newPhotos),
        "Upload photos",
        90000
      );
      await withTimeout(
        insertGiftPhotos(insertedGift.id, photoUrls),
        "Enregistrement des photos"
      );
      await withTimeout(
        syncGiftCoverPhoto(insertedGift.id),
        "Mise à jour photo principale"
      );
      setStatus("Finalisation...");

      const { data: maxSort, error: maxSortError } = await withTimeout(
        supabaseClient
          .from("gifts")
          .select("sort_order")
          .order("sort_order", { ascending: false })
          .limit(1),
        "Calcul ordre cadeaux"
      );

      if (!maxSortError) {
        const nextSort =
          maxSort && maxSort.length ? Number(maxSort[0].sort_order || 0) + 1 : 1;

        await withTimeout(
          supabaseClient
            .from("gifts")
            .update({ sort_order: nextSort })
            .eq("id", insertedGift.id),
          "Mise à jour ordre cadeau"
        );
      }

      await withTimeout(loadAdminGifts(), "Rechargement des cadeaux");
      setStatus("Cadeau ajouté avec succès.");
      resetGiftForm();
    }
  } catch (error) {
    console.error("gift_save_error", error);
    setStatus(`Impossible d'enregistrer ce cadeau: ${getErrorMessage(error)}`, true);
  } finally {
    stopSaveWatchdog();
    giftSubmitBtn.disabled = false;
  }
});

giftCancelEditBtn.addEventListener("click", () => {
  resetGiftForm();
  setStatus("Modification annulée.");
});

existingPhotos.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action='remove-photo']");
  if (!button) {
    return;
  }

  const photoId = button.dataset.photoId;
  if (!photoId) {
    return;
  }

  await removePhoto(photoId);
});

adminGiftList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const action = button.dataset.action;
  const giftId = button.dataset.giftId;

  if (!giftId) {
    return;
  }

  if (action === "edit") {
    startEditGift(giftId);
    setStatus("Mode modification activé.");
    return;
  }

  if (action === "delete") {
    await deleteGift(giftId);
  }
});

logoutBtn.addEventListener("click", async () => {
  if (!supabaseClient) {
    setStatus("Client Supabase non initialisé.", true);
    return;
  }

  logoutBtn.disabled = true;
  setStatus("Déconnexion en cours...");

  const { error } = await supabaseClient.auth.signOut();
  logoutBtn.disabled = false;

  if (error) {
    setStatus("Échec de la déconnexion. Réessaie.", true);
    return;
  }

  clearDashboard();
  resetGiftForm();
  showDashboard(false);
  setStatus("Tu es déconnectée.");
});

async function init() {
  if (!isSupabaseConfigured()) {
    setStatus(
      "Configuration Supabase manquante: complète config.js (supabaseUrl et supabaseAnonKey).",
      true
    );
    showDashboard(false);
    return;
  }

  supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    ADMIN_SUPABASE_OPTIONS
  );
  resetGiftForm();
  await refreshSessionUi();

  supabaseClient.auth.onAuthStateChange(() => {
    window.setTimeout(() => {
      refreshSessionUi();
    }, 0);
  });
}

init();
