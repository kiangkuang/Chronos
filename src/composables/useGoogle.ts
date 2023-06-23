import { StorageSerializers, useScriptTag, useSessionStorage } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { useSettingsStore } from 'src/stores/settings-store';
import { ref, watchEffect } from 'vue';
import { Notify } from 'quasar';
import { DateTime } from 'luxon';
import { IEvent } from '../interfaces/event';

const CLIENT_ID = process.env.GOOGLE_API_CLIENT_ID || '';
const API_KEY = process.env.GOOGLE_API_KEY;
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/calendar.readonly';

const isLoading = ref(true);

const isAuthenticated = ref(false);
const token = useSessionStorage<google.accounts.oauth2.TokenResponse | null>('token', null, { serializer: StorageSerializers.object });
const tokenExpiry = useSessionStorage<DateTime | null>('tokenExpiry', null, {
  serializer: {
    read: (raw) => (raw ? DateTime.fromISO(raw) : null),
    write: (value) => value?.toISO() ?? '',
  },
});

const loadGoogle = new Promise<typeof google>((resolve) => {
  useScriptTag('https://accounts.google.com/gsi/client', () => {
    resolve(google);
  });
});

const loadGapi = new Promise<typeof gapi>((resolve) => {
  useScriptTag('https://apis.google.com/js/api.js', () => {
    gapi.load('client', async () => {
      await gapi.client.init({
        apiKey: API_KEY,
        discoveryDocs: [DISCOVERY_DOC],
      });

      isLoading.value = false;

      watchEffect(() => {
        if (token.value && tokenExpiry.value && tokenExpiry.value > DateTime.now()) {
          gapi.client.setToken(token.value);
          isAuthenticated.value = true;
        } else {
          isAuthenticated.value = false;
        }
      });

      resolve(gapi);
    });
  });
});

const signIn = async () => {
  const google = await loadGoogle;
  return new Promise<google.accounts.oauth2.TokenResponse>((resolve) => {
    google.accounts.oauth2
      .initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (response) => {
          token.value = response;
          tokenExpiry.value = DateTime.now().plus({ seconds: Number(response.expires_in) });
          resolve(response);
        },
      })
      .requestAccessToken();
  });
};

const signOut = async () => {
  const google = await loadGoogle;
  return new Promise<void>((resolve, reject) => {
    if (!token.value) {
      reject('no token');
      return;
    }

    google.accounts.oauth2
      .revoke(token.value.access_token, () => {
        token.value = null;
        tokenExpiry.value = null;
        isAuthenticated.value = false;
        resolve();
      });
  });
};

const events = ref<IEvent[]>([]);
const { minDate, maxDate } = storeToRefs(useSettingsStore());
const updateEvents = async () => {
  const gapi = await loadGapi;
  try {
    const response = await gapi.client.calendar.events.list({
      calendarId: 'primary',
      timeMin: minDate.value.toISO(),
      timeMax: maxDate.value.toISO(),
      showDeleted: false,
      singleEvents: true,
    });

    events.value = response.result.items.filter((event) => event.attendees?.find((attendee) => attendee.self && attendee.responseStatus !== 'declined'));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);

    signOut();

    Notify.create({
      icon: 'error',
      message: 'Google API error!',
      caption: 'Try again later',
      color: 'negative',
      position: 'top-right',
      progress: true,
    });
  }
};

export const useGoogle = () => ({
  isLoading,

  isAuthenticated,
  signIn,
  signOut,

  updateEvents,
  events,
});
