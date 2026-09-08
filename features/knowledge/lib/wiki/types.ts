export interface WikiSourceEvidence {
  id: string;
  type: "ticket" | "commit" | "note" | "document" | "project";
  title: string;
  url: string;
}

export interface WikiPage {
  id: string;
  slug: string; // unique identifier e.g. "project-wifi-camera"
  title: string; // e.g. "《wifi相机 项目研发全貌与技术架构总览》"
  category: "project_overview" | "architecture_overview" | "topic_synthesis";
  projectId?: string;
  projectName?: string;
  summary: string;
  content: string; // Full markdown synthesized text
  keyModules: Array<{ name: string; description: string }>;
  relatedTickets: Array<{ ticketNo: number; title: string }>;
  sourceEvidence: WikiSourceEvidence[];
  knowledgeNodeIds?: string[];
  version: number;
  generatedAt: string;
  updatedAt: string;
}
