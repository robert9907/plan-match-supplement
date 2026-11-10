// The 30 numbered checkpoints for Plan Match Supplement. Position in this
// list is the checkpoint number (index 0 = checkpoint 1). Never reorder or
// delete — the bottleneck report (v_pm_checkpoint_funnel) reads the numbers.
export const SUPPLEMENT_CHECKPOINTS = [
  'wp_button_seen',          //  1 Plan Match button on screen (WordPress snippet)
  'wp_button_click',         //  2 Plan Match button clicked (WordPress snippet)
  'app_loaded',              //  3 Supplement tool loaded
  'about_shown',             //  4 "About you" on screen
  'prompt_picked',           //  5 Picked what's prompting this
  'birth_date_entered',      //  6 Full birth date entered (meta.age_band)
  'gender_picked',           //  7 Picked gender
  'tobacco_picked',          //  8 Answered tobacco
  'zip_entered',             //  9 Valid 5-digit ZIP
  'rates_shown',             // 10 Rate projection on screen
  'meds_shown',              // 11 Medications screen on screen
  'med_search_opened',       // 12 Opened the pill scan or the med search
  'med_added',               // 13 Added at least one medication
  'providers_shown',         // 14 Doctors screen on screen (meta.skipped_meds)
  'provider_search_opened',  // 15 Started a doctor search
  'provider_added',          // 16 Added at least one doctor
  'health_shown',            // 17 Health questions on screen (meta.skipped_providers)
  'health_first_answer',     // 18 Answered the first health question
  'height_weight_entered',   // 19 Entered height and weight
  'results_shown',           // 20 Carrier results on screen
  'fit_explainer_opened',    // 21 Opened "How is the Fit Score calculated?"
  'compare_opened',          // 22 Opened the carrier compare
  'plan_selected',           // 23 Picked a carrier + plan letter
  'apply_shown',             // 24 Application on screen
  'details_started',         // 25 Started the applicant details
  'contact_filled',          // 26 Phone or email filled
  'address_filled',          // 27 Street address filled
  'authorizations_checked',  // 28 All authorization boxes checked
  'signed',                  // 29 Signed the application
  'action_taken',            // 30 Submitted the application or tapped to call
] as const;
