import { refAutoReset, until, useScriptTag } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { useSettingsStore } from 'src/stores/settings-store';
import { ref } from 'vue';
import { Notify } from 'quasar';
import { IEvent } from '../interfaces/event';

const CLIENT_ID = process.env.GOOGLE_API_CLIENT_ID || '';
const API_KEY = process.env.GOOGLE_API_KEY;
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/calendar.readonly';

const gapiLoaded = ref(false);
const gsiLoaded = ref(false);
const events = ref<IEvent[]>([]);
const isAuthenticated = ref(false);
const isLoading = refAutoReset(false, 30 * 1000);

useScriptTag('https://apis.google.com/js/api.js', () => {
  window.gapi.load('client', async () => {
    await window.gapi.client.init({
      apiKey: API_KEY,
      discoveryDocs: [DISCOVERY_DOC],
    });
    gapiLoaded.value = true;
  });
});

useScriptTag('https://accounts.google.com/gsi/client', () => {
  gsiLoaded.value = true;
});

const checkToken = async (callback: () => Promise<void>) => {
  isLoading.value = true;
  try {
    await until(gsiLoaded).toBeTruthy({ timeout: 3000, throwOnTimeout: true });
    await until(gapiLoaded).toBeTruthy({ timeout: 3000, throwOnTimeout: true });
  } catch {
    Notify.create({
      icon: 'error',
      message: 'Google script loading timeout!',
      caption: 'Try disabling your ad blocker',
      color: 'negative',
      position: 'top-right',
      progress: true,
    });
    isLoading.value = false;
  }

  const callbackFn = async () => {
    isAuthenticated.value = true;
    await callback();
    isLoading.value = false;
  };

  const tokenClient = window.google.accounts.oauth2
    .initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: callbackFn,
    });

  if (window.gapi.client.getToken() === null) {
    // Prompt the user to select a Google Account and ask for consent to share their data
    // when establishing a new session.
    tokenClient.requestAccessToken();
  } else {
    await callbackFn();
  }
};
const { minDate, maxDate } = storeToRefs(useSettingsStore());

const getEvents = async () => {
  try {
    const response = await window.gapi.client.calendar.events.list({
      calendarId: 'primary',
      timeMin: minDate.value.toISO(),
      timeMax: maxDate.value.toISO(),
      showDeleted: false,
      singleEvents: true,
    });

    events.value = response.result.items.filter((event) => event.attendees?.find((attendee) => attendee.self && attendee.responseStatus !== 'declined'));
  } catch {
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

const updateEvents = () => {
  checkToken(getEvents);
};

export const useGoogleCalendar = () => ({
  updateEvents,
  events,
  isLoading,
  isAuthenticated,
});
