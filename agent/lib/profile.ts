import data from "../../data/profile.json";

// Structured profile built from the resume. Edit profile.json to change it;
// fill in `preferences` and `answers` (work authorization, notice period, etc.).
export const profile = data;
export type Profile = typeof data;

// Where alerts are sent. Defaults to the resume email; override with ALERT_TO_EMAIL.
export const alertEmail = () => process.env.ALERT_TO_EMAIL ?? profile.contact.email;
