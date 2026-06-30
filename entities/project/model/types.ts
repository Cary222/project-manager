export type ProjectStatus = "ACTIVE" | "ARCHIVED";

export type ModuleWithDetails = {
  id: string;
  name: string;
  description: string | null;
  tickets: MyTicket[];
};

export type ResponsibilityWithDetails = {
  id: string;
  kind: "PROGRAM" | "DESIGN" | "BUG";
  modules: ModuleWithDetails[];
};

export type Project = {
  id: string;
  name: string;
  description: string | null;
  responsibilities: ResponsibilityWithDetails[];
};

// List-view ticket used by dashboard / project detail
export type MyTicket = {
  id: string;
  ticketNo: number;
  title: string;
  status: "DEVELOPING" | "READY_FOR_TEST" | "DELIVERED" | "DONE" | "OVERDUE" | "CLOSED";
  priority: number;
  deadline: string | null;
  project: { id: string; name: string };
  module: { name: string; responsibility: { kind: "PROGRAM" | "DESIGN" } };
  assignees: { name: string | null; email: string }[];
};
