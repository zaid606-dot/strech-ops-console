export type ServiceRequest = {
  id: string;
  homeowner_id: string;
  property_id: string;
  category_id: string;
  status: string;
  details: Record<string, unknown>;
  preferred_window_start: string | null;
  preferred_window_end: string | null;
  assigned_contractor_id: string | null;
  appointment_id: string | null;
  promise_by: string | null;
  confirmed_at: string | null;
  confirmation_code: string | null;
  arrival_acked_at: string | null;
  dispatch_owner?: string;
  created_at: string;
  updated_at: string;
};

export type Charge = {
  id: string;
  service_request_id: string;
  amount_cents: number;
  currency: string;
  status: string;
  membership_tier: string;
  category_id: string;
  note: string | null;
  created_at: string;
};

export type ReminderJob = {
  id: string;
  service_request_id: string;
  kind: string;
  fire_at: string;
  timezone: string;
  status: string;
  fired_at: string | null;
  created_at: string;
};

export type Property = {
  id: string;
  homeowner_id: string;
  address_line1: string;
  address_line2?: string | null;
  city: string;
  state: string;
  zip: string;
};

export type ContractorCandidate = {
  contractor_id: string;
  full_name: string;
  vetting_status: string;
  rating: number | null;
  next_open_slot_start: string;
  next_open_slot_end: string;
};

export type Contractor = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  rating: number | null;
  categories: string[];
  service_zips: string[];
  vetting_status: string;
  vetted_at: string | null;
};

export type JobEvent = {
  id: string;
  service_request_id?: string;
  from_status: string | null;
  to_status: string;
  actor_role: string;
  actor_id: string;
  note: string | null;
  created_at: string;
};
