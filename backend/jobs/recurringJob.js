/**
 * jobs/recurringJob.js
 *
 * Cron job that automatically clones recurring transactions on their due date.
 *
 * When a user marks a transaction as recurring (isRecurring: true), it acts
 * as a template. This job runs every day at 00:05 IST, finds all templates,
 * and creates new copies for any that are due today based on their frequency
 * (Daily / Weekly / Monthly).
 *
 * Why one job instead of three separate crons (daily/weekly/monthly)?
 *   Simpler to reason about - one place to debug, one log stream to watch.
 *   Also more resilient to server restarts: if the server was down at midnight,
 *   the job fires once on startup and catches up anything that was missed.
 *   lastGeneratedAt prevents double-generation even if the server restarts mid-day.
 *
 * The original template document is never modified by the generated copies -
 * only lastGeneratedAt is updated on the template after each successful generation.
 * Copies have isGeneratedCopy: true so the UI can optionally badge them as "Auto".
 *
 * Called once in server.js after MongoDB connects:
 *   const { startRecurringJob } = require('./jobs/recurringJob');
 *   startRecurringJob();
 */

const cron = require("node-cron");
const Transaction = require("../models/Transaction");

// --- isDueToday ---------------------------------------------------------------
/**
 * Checks whether a recurring transaction template is due to generate a copy today.
 *
 * Compares lastGeneratedAt against today's date (normalised to midnight)
 * to decide based on the transaction's frequency:
 *   Daily   → at least 1 full day since last generation
 *   Weekly  → at least 7 days since last generation
 *   Monthly → last generation was in a previous calendar month
 *
 * @param {Date|null} lastGeneratedAt - When the cron last ran for this template
 * @param {string}    frequency       - "Daily" | "Weekly" | "Monthly"
 * @returns {boolean}
 */
const isDueToday = (lastGeneratedAt, frequency) => {
  const now = new Date();

  // First time this template has ever been processed - generate immediately
  if (!lastGeneratedAt) return true;

  const last = new Date(lastGeneratedAt);

  // Normalise both dates to midnight so we're comparing calendar days, not timestamps
  const todayMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const lastMidnight = new Date(
    last.getFullYear(),
    last.getMonth(),
    last.getDate(),
  );
  const daysDiff = Math.floor(
    (todayMidnight - lastMidnight) / (1000 * 60 * 60 * 24),
  );

  switch (frequency) {
    case "Daily":
      return daysDiff >= 1;
    case "Weekly":
      return daysDiff >= 7;
    case "Monthly":
      // add 1 exact month to the last generated date
      const nextDue = new Date(lastMidnight);
      nextDue.setMonth(nextDue.getMonth() + 1);
      return todayMidnight >= nextDue;
    default:
      return false;
  }
};

// --- processRecurring ---------------------------------------------------------
/**
 * Main logic executed on every cron tick (and once on startup).
 * Fetches all recurring template transactions across all users and
 * generates copies for any that are due today.
 *
 * Each template is processed independently - a failure on one doesn't
 * abort the rest of the job.
 */
const processRecurring = async () => {
  const startTime = Date.now();
  console.log(`[RecurringJob] 🔄 Starting at ${new Date().toISOString()}`);

  let processed = 0;
  let generated = 0;
  let errors = 0;

  try {
    // Only fetch templates (isGeneratedCopy: false) so we never accidentally
    // recurse on auto-generated copies and create infinite duplicates
    const templates = await Transaction.find({
      isRecurring: true,
      isGeneratedCopy: false,
    }).lean();

    console.log(
      `[RecurringJob] Found ${templates.length} recurring template(s).`,
    );

    for (const template of templates) {
      processed++;

      try {
        if (!isDueToday(template.lastGeneratedAt, template.recurringFrequency))
          continue; // not due yet - skip silently

        // Create a new copy for today - same fields as the template except:
        // date → today, isRecurring → false, isGeneratedCopy → true
        await Transaction.create({
          title: template.title,
          amount: template.amount,
          type: template.type,
          category: template.category,
          date: new Date(),
          notes: template.notes || "",
          user_id: template.user_id,
          isRecurring: false, // copies are not templates themselves
          recurringFrequency: null,
          isGeneratedCopy: true, // UI can badge these as "Auto"
        });

        // Update lastGeneratedAt on the template so we don't re-generate it today
        // if the server restarts or the job fires again for any reason
        await Transaction.findByIdAndUpdate(template._id, {
          lastGeneratedAt: new Date(),
        });

        generated++;
        console.log(
          `[RecurringJob] ✅ Generated copy for: "${template.title}" ` +
            `(${template.recurringFrequency}, user: ${template.user_id})`,
        );
      } catch (templateError) {
        errors++;
        console.error(
          `[RecurringJob] ❌ Failed for template ${template._id}:`,
          templateError.message,
        );
        // Continue with the remaining templates - one failure shouldn't kill the whole job
      }
    }
  } catch (err) {
    console.error(
      "[RecurringJob] ❌ Fatal error fetching templates:",
      err.message,
    );
  }

  const elapsed = Date.now() - startTime;
  console.log(
    `[RecurringJob] ✅ Done in ${elapsed}ms - ` +
      `Checked: ${processed}, Generated: ${generated}, Errors: ${errors}`,
  );
};

// --- startRecurringJob --------------------------------------------------------
/**
 * Registers the daily cron schedule and runs one immediate check on startup.
 *
 * Cron expression: '5 0 * * *'
 *   ┌---------- minute (5)
 *   │ ┌-------- hour (0 = midnight)
 *   │ │ ┌------ day of month (every day)
 *   │ │ │ ┌---- month (every month)
 *   │ │ │ │ ┌-- day of week (every day)
 *   5 0 * * *
 *
 * Running at 00:05 instead of exactly midnight to avoid any edge cases
 * where the DB connection is still warming up at 00:00:00.
 *
 * The startup run catches anything that was due while the server was down
 * (e.g. the server was restarted at 00:10 after missing the scheduled run).
 * This is called from server.js after the MongoDB connection is established.
 */
const startRecurringJob = () => {
  if (!cron.validate("5 0 * * *")) {
    console.error("[RecurringJob] Invalid cron expression. Job not started.");
    return;
  }

  cron.schedule("5 0 * * *", processRecurring, {
    timezone: "Asia/Kolkata", // IST - matches the ₹ Indian user base
  });

  console.log("[RecurringJob] 📅 Scheduled - runs daily at 00:05 IST.");

  // Fire once immediately on startup to catch any missed generations
  processRecurring().catch((err) => {
    console.error("[RecurringJob] Startup run failed:", err.message);
  });
};

module.exports = { startRecurringJob, processRecurring };
