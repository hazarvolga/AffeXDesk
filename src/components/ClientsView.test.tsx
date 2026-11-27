import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientsView } from "./ClientsView";
import {
  api,
  type ClientProjectRecord,
  type ClientRecord,
  type ProjectInfo,
  type WorkspaceRecord,
} from "../lib/api";

vi.mock("../lib/api", () => ({
  api: {
    saveClient: vi.fn(),
    deleteClient: vi.fn(),
    saveClientProject: vi.fn(),
    deleteClientProject: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);

const SAMPLE_WORKSPACES: WorkspaceRecord[] = [
  {
    id: 1,
    path: "/Users/tester/dev",
    label: "dev",
    created_at: "2026-11-27T10:00:00Z",
  },
];

const SAMPLE_WS_PROJECTS: ProjectInfo[] = [
  {
    name: "acme-portal",
    path: "/Users/tester/dev/acme-portal",
    workspace_label: "dev",
    stack: ["TypeScript"],
    git_branch: "main",
    git_dirty_count: 3,
    git_last_commit: "feat: add dashboard",
    progress_done: 4,
    progress_total: 5,
    progress_pct: 80,
    live_url: "https://acme.example.com",
    reclaimable_bytes: 0,
    reclaimable_dirs: [],
    last_modified_days_ago: 0,
  },
  {
    name: "unassigned-app",
    path: "/Users/tester/dev/unassigned-app",
    workspace_label: "dev",
    stack: ["Rust"],
    git_branch: "develop",
    git_dirty_count: 0,
    git_last_commit: "chore: init",
    progress_done: 0,
    progress_total: 0,
    progress_pct: null,
    live_url: null,
    reclaimable_bytes: 0,
    reclaimable_dirs: [],
    last_modified_days_ago: 1,
  },
];

const SAMPLE_CLIENTS: ClientRecord[] = [
  {
    id: 10,
    name: "Acme Corp",
    contact_name: "Ali Kaya",
    contact_info: "ali@acme.example.com",
    remote_tool: "rustdesk",
    remote_id: "123 456 789",
    os_info: "Windows 11",
    notes: "Allplan 2026",
    last_connected_at: null,
    created_at: "2026-11-27T10:00:00Z",
  },
];

const SAMPLE_CLIENT_PROJECTS: ClientProjectRecord[] = [
  {
    id: 100,
    client_id: 10,
    title: "Acme Portal",
    status: "active",
    priority: "high",
    progress_pct: 50,
    due_date: "2026-12-01",
    local_path: "/Users/tester/dev/acme-portal",
    live_url: "https://acme.example.com",
    notes: "Sprint 2",
    updated_at: "2026-11-27T12:00:00Z",
  },
];

describe("ClientsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders linked project live Git status and unassigned dev/ projects", () => {
    render(
      <ClientsView
        clients={SAMPLE_CLIENTS}
        projects={SAMPLE_CLIENT_PROJECTS}
        workspaces={SAMPLE_WORKSPACES}
        workspaceProjects={SAMPLE_WS_PROJECTS}
        onReloadClients={vi.fn().mockResolvedValue(undefined)}
        onRescanWorkspaces={vi.fn().mockResolvedValue(undefined)}
        onAddWorkspace={vi.fn()}
        onAssignProject={vi.fn().mockResolvedValue(undefined)}
        onConnectRemote={vi.fn().mockResolvedValue(undefined)}
        onOpenFinder={vi.fn()}
        onOpenIde={vi.fn()}
        onOpenUrl={vi.fn()}
        onNotify={vi.fn()}
      />
    );

    expect(screen.getByText("Acme Portal")).toBeInTheDocument();
    expect(screen.getByText("3 değişiklik")).toBeInTheDocument();
    expect(screen.getByText("feat: add dashboard")).toBeInTheDocument();
    expect(screen.getByText("unassigned-app")).toBeInTheDocument();
    expect(screen.getByText("Git Temiz")).toBeInTheDocument();
  });

  it("creates client & binds unassigned dev/ project in one flow and clears pendingBindProject on cancel", async () => {
    const onAssignProject = vi.fn().mockResolvedValue(undefined);
    mockedApi.saveClient.mockResolvedValue({
      id: 22,
      name: "Beta Studio",
      contact_name: "",
      contact_info: "",
      remote_tool: "rustdesk",
      remote_id: "999 888 777",
      os_info: "",
      notes: "",
      last_connected_at: null,
      created_at: "2026-11-27T12:00:00Z",
    });

    render(
      <ClientsView
        clients={SAMPLE_CLIENTS}
        projects={SAMPLE_CLIENT_PROJECTS}
        workspaces={SAMPLE_WORKSPACES}
        workspaceProjects={SAMPLE_WS_PROJECTS}
        onReloadClients={vi.fn().mockResolvedValue(undefined)}
        onRescanWorkspaces={vi.fn().mockResolvedValue(undefined)}
        onAddWorkspace={vi.fn()}
        onAssignProject={onAssignProject}
        onConnectRemote={vi.fn().mockResolvedValue(undefined)}
        onOpenFinder={vi.fn()}
        onOpenIde={vi.fn()}
        onOpenUrl={vi.fn()}
        onNotify={vi.fn()}
      />
    );

    // Open bind flow then cancel -> pendingBindProject must reset
    fireEvent.click(screen.getByRole("button", { name: /Müşteri Oluştur & Bağla/i }));
    expect(
      screen.getByText(/Yeni Müşteri Oluştur & "unassigned-app" Projesini Bağla/i)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Vazgeç$/i }));

    // Open again and submit
    fireEvent.click(screen.getByRole("button", { name: /Müşteri Oluştur & Bağla/i }));
    fireEvent.change(screen.getByPlaceholderText(/Örn\. ABC Mimarlık/i), {
      target: { value: "Beta Studio" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Kaydet$/i }));

    await waitFor(() => {
      expect(mockedApi.saveClient).toHaveBeenCalledTimes(1);
      expect(onAssignProject).toHaveBeenCalledWith(
        SAMPLE_WS_PROJECTS[1],
        22,
        "Beta Studio"
      );
    });
  });
});
