<template>
  <div class="admin-page">
    <hgroup>
      <h1>Admin</h1>
      <p>User management</p>
    </hgroup>

    <div v-if="!authStore.isAdmin" class="access-denied">
      <i class="bi bi-shield-lock" />
      <p>Access denied. Admin privileges required.</p>
    </div>

    <template v-else>
      <section>
        <header class="section-header">
          <h2>Users</h2>
          <button @click="showCreateDialog = true">
            <i class="bi bi-plus-lg" /> Add User
          </button>
        </header>

        <div v-if="loading" class="loading-indicator" />

        <table v-else>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Created</th>
              <th>API Key</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="user in users" :key="user.id">
              <td>{{ user.name }}</td>
              <td>
                <select
                  :value="user.role"
                  :disabled="user.id === authStore.currentUser?.id"
                  @change="updateRole(user.id, $event.target.value)"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </td>
              <td>{{ formatDate(user.dateCreated) }}</td>
              <td>
                <button
                  class="small secondary"
                  @click="openApiKeyDialog(user)"
                >
                  <i class="bi bi-key" />
                  {{ user.hasApiKey ? 'Manage' : 'Generate' }}
                </button>
              </td>
              <td>
                <button
                  v-if="user.id !== authStore.currentUser?.id"
                  class="small contrast"
                  @click="confirmDeleteUser(user)"
                >
                  <i class="bi bi-trash" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <!-- Create User Dialog -->
    <dialog
      ref="createDialogEl"
      @close="showCreateDialog = false"
    >
      <article>
        <header>
          <h3>Add User</h3>
          <button
            class="close-btn"
            aria-label="Close"
            @click="showCreateDialog = false"
          />
        </header>
        <form @submit.prevent="createUser">
          <label>
            Username
            <input
              v-model="newUser.name"
              type="text"
              required
              placeholder="Username"
            />
          </label>
          <label>
            Password
            <input
              v-model="newUser.password"
              type="password"
              required
              placeholder="Password"
            />
          </label>
          <label>
            Role
            <select v-model="newUser.role">
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <footer class="dialog-footer">
            <button type="submit" :aria-busy="creating">Create</button>
            <button
              class="secondary"
              type="button"
              @click="showCreateDialog = false"
            >
              Cancel
            </button>
          </footer>
        </form>
      </article>
    </dialog>

    <!-- Delete Confirmation -->
    <dialog
      ref="deleteDialogEl"
      @close="deleteTarget = null"
    >
      <article>
        <header>
          <h3>Delete User</h3>
        </header>
        <p>Are you sure you want to delete user "{{ deleteTarget?.name }}"?</p>
        <footer class="dialog-footer">
          <button class="secondary" @click="deleteTarget = null">Cancel</button>
          <button class="contrast" :aria-busy="deleting" @click="deleteUser">
            Delete
          </button>
        </footer>
      </article>
    </dialog>

    <!-- API Key Dialog -->
    <dialog
      ref="apiKeyDialogEl"
      @close="apiKeyTarget = null"
    >
      <article>
        <header>
          <h3>API Key for {{ apiKeyTarget?.name }}</h3>
          <button
            class="close-btn"
            aria-label="Close"
            @click="apiKeyTarget = null"
          />
        </header>
        <div v-if="apiKeyLoading" class="loading-indicator" />
        <template v-else>
          <div v-if="userApiKey" class="api-key-admin-display">
            <label>
              Current API key (masked)
              <input :value="userApiKey.key" type="text" readonly class="api-key-input" />
            </label>
            <small class="api-key-date">Created {{ formatDate(userApiKey.dateCreated) }}</small>
            <div v-if="newlyGeneratedKey" class="api-key-new">
              <label>
                <strong>New API key</strong> — copy it now, it won't be shown again:
                <div class="api-key-input-row">
                  <input :value="newlyGeneratedKey" type="text" readonly class="api-key-input" />
                  <button class="btn-copy" @click="copyNewKey">
                    <i class="bi bi-clipboard" /> Copy
                  </button>
                </div>
              </label>
            </div>
            <footer class="dialog-footer">
              <button class="secondary" :aria-busy="regeneratingKey" @click="regenerateUserApiKey">
                <i class="bi bi-arrow-clockwise" /> Regenerate
              </button>
              <button class="contrast" :aria-busy="deletingKey" @click="deleteUserApiKey">
                <i class="bi bi-trash" /> Delete
              </button>
            </footer>
          </div>
          <div v-else class="api-key-admin-generate">
            <p>This user has no API key.</p>
            <footer class="dialog-footer">
              <button :aria-busy="generatingKey" @click="generateUserApiKey">
                <i class="bi bi-key" /> Generate API Key
              </button>
              <button class="secondary" @click="apiKeyTarget = null">Close</button>
            </footer>
            <div v-if="newlyGeneratedKey" class="api-key-new">
              <label>
                <strong>New API key</strong> — copy it now, it won't be shown again:
                <div class="api-key-input-row">
                  <input :value="newlyGeneratedKey" type="text" readonly class="api-key-input" />
                  <button class="btn-copy" @click="copyNewKey">
                    <i class="bi bi-clipboard" /> Copy
                  </button>
                </div>
              </label>
            </div>
          </div>
        </template>
      </article>
    </dialog>
  </div>
</template>

<script setup>
import api from "../utils/api";

const authStore = useAuthStore();
const router = useRouter();

const loading = ref(true);
const users = ref([]);
const showCreateDialog = ref(false);
// Modal dialog wiring: backdrop, focus trap, Escape to close
const createDialogEl = useModalDialog(() => showCreateDialog.value);
const creating = ref(false);
const deleting = ref(false);
const deleteTarget = ref(null);
const deleteDialogEl = useModalDialog(() => deleteTarget.value !== null);

// API Key management
const apiKeyTarget = ref(null);
const apiKeyDialogEl = useModalDialog(() => apiKeyTarget.value !== null);
const apiKeyLoading = ref(false);
const userApiKey = ref(null);
const newlyGeneratedKey = ref("");
const generatingKey = ref(false);
const regeneratingKey = ref(false);
const deletingKey = ref(false);

const newUser = ref({ name: "", password: "", role: "user" });

function formatDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString();
}

async function fetchUsers() {
  loading.value = true;
  try {
    const res = await api.get("/users");
    // Check which users have API keys
    const usersWithKeys = await Promise.all(
      res.data.map(async (user) => {
        try {
          await api.get(`/users/${user.id}/api-key`);
          return { ...user, hasApiKey: true };
        } catch {
          return { ...user, hasApiKey: false };
        }
      }),
    );
    users.value = usersWithKeys;
  } catch (e) {
    if (e.response?.status === 403) {
      router.push("/login");
    }
  } finally {
    loading.value = false;
  }
}

async function createUser() {
  creating.value = true;
  try {
    const res = await api.post("/users", newUser.value);
    users.value.push(res.data.user);
    showCreateDialog.value = false;
    newUser.value = { name: "", password: "", role: "user" };
  } catch (e) {
    alert(e.response?.data?.error || "Failed to create user");
  } finally {
    creating.value = false;
  }
}

async function updateRole(userId, role) {
  try {
    await api.put(`/users/${userId}`, { role });
    await fetchUsers();
  } catch (e) {
    alert(e.response?.data?.error || "Failed to update role");
  }
}

function confirmDeleteUser(user) {
  deleteTarget.value = user;
}

async function deleteUser() {
  if (!deleteTarget.value) return;
  deleting.value = true;
  try {
    await api.delete(`/users/${deleteTarget.value.id}`);
    users.value = users.value.filter((u) => u.id !== deleteTarget.value.id);
    deleteTarget.value = null;
  } catch (e) {
    alert(e.response?.data?.error || "Failed to delete user");
  } finally {
    deleting.value = false;
  }
}

onMounted(async () => {
  if (authStore.isAdmin) {
    await fetchUsers();
  } else {
    loading.value = false;
  }
});

// API Key functions
async function openApiKeyDialog(user) {
  apiKeyTarget.value = user;
  newlyGeneratedKey.value = "";
  await fetchUserApiKey(user.id);
}

async function fetchUserApiKey(userId) {
  apiKeyLoading.value = true;
  try {
    const res = await api.get(`/users/${userId}/api-key`);
    userApiKey.value = res.data;
  } catch {
    userApiKey.value = null;
  } finally {
    apiKeyLoading.value = false;
  }
}

async function generateUserApiKey() {
  if (!apiKeyTarget.value) return;
  generatingKey.value = true;
  try {
    const res = await api.post(`/users/${apiKeyTarget.value.id}/api-key`);
    newlyGeneratedKey.value = res.data.key;
    // Update the user's hasApiKey status
    const user = users.value.find((u) => u.id === apiKeyTarget.value.id);
    if (user) user.hasApiKey = true;
    await fetchUserApiKey(apiKeyTarget.value.id);
  } catch (e) {
    alert(e.response?.data?.error || "Failed to generate API key");
  } finally {
    generatingKey.value = false;
  }
}

async function regenerateUserApiKey() {
  if (!apiKeyTarget.value) return;
  if (!confirm("Regenerating will invalidate the current key. Continue?")) return;
  regeneratingKey.value = true;
  try {
    const res = await api.post(`/users/${apiKeyTarget.value.id}/api-key`);
    newlyGeneratedKey.value = res.data.key;
    await fetchUserApiKey(apiKeyTarget.value.id);
  } catch (e) {
    alert(e.response?.data?.error || "Failed to regenerate API key");
  } finally {
    regeneratingKey.value = false;
  }
}

async function deleteUserApiKey() {
  if (!apiKeyTarget.value) return;
  if (!confirm("Delete this user's API key? This cannot be undone.")) return;
  deletingKey.value = true;
  try {
    await api.delete(`/users/${apiKeyTarget.value.id}/api-key`);
    userApiKey.value = null;
    newlyGeneratedKey.value = "";
    // Update the user's hasApiKey status
    const user = users.value.find((u) => u.id === apiKeyTarget.value.id);
    if (user) user.hasApiKey = false;
  } catch (e) {
    alert(e.response?.data?.error || "Failed to delete API key");
  } finally {
    deletingKey.value = false;
  }
}

function copyNewKey() {
  navigator.clipboard.writeText(newlyGeneratedKey.value);
}
</script>

<style scoped>
.access-denied {
  text-align: center;
  padding: 3em;
  color: var(--color-text-muted);
}

.access-denied i {
  font-size: var(--text-icon);
  margin-bottom: var(--space-sm);
}

table {
  width: 100%;
}

table select {
  margin: 0;
  padding: var(--space-2xs);
  font-size: var(--text-md);
}

button.small {
  padding: 0.2em 0.5em;
  font-size: var(--text-base);
}
</style>
