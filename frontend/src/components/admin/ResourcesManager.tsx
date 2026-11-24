"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useId, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, apiFetch } from "@/lib/api";

import { SortableList } from "./SortableList";

// Mirror AdminResourceTagDTO and AdminResourceDTO in backend/app/schemas/resources.py.
export type AdminResourceTag = {
  id: string;
  name: string;
  display_order: number;
};

export type AdminResource = {
  id: string;
  name: string;
  description: string;
  url: string | null;
  phone: string | null;
  is_unc: boolean;
  is_crisis: boolean;
  is_published: boolean;
  display_order: number;
  tags: AdminResourceTag[];
};

// Fields used from AdminFitGuideItemDTO in backend/app/schemas/fit_guide.py.
type FitGuideLink = { id: string; text: string; resource_id: string | null };

const resourcesKey = ["admin-resources"] as const;
const tagsKey = ["admin-resource-tags"] as const;
const fitGuideKey = ["admin-fit-guide"] as const;
const selectClass =
  "min-h-11 rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30";

function useResources() {
  return useQuery({
    queryKey: resourcesKey,
    queryFn: () => apiFetch<AdminResource[]>("/api/admin/resources"),
  });
}

function sendJson<T>(path: string, method: string, body: unknown) {
  return apiFetch<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function errorMessage(error: unknown) {
  return error instanceof ApiError
    ? error.detail
    : "Something went wrong. Please try again.";
}

function nextOrder(items: { display_order: number }[]) {
  return Math.max(-1, ...items.map((item) => item.display_order)) + 1;
}

type Editor =
  | { kind: "resource"; resource?: AdminResource }
  | { kind: "tag"; tag?: AdminResourceTag }
  | { kind: "delete-resource"; resource: AdminResource }
  | { kind: "delete-tag"; tag: AdminResourceTag }
  | { kind: "reorder-resources" }
  | null;

export function ResourcesManager() {
  const id = useId();
  const queryClient = useQueryClient();
  const resources = useResources();
  const tags = useQuery({
    queryKey: tagsKey,
    queryFn: () => apiFetch<AdminResourceTag[]>("/api/admin/resource-tags"),
  });
  const [tagId, setTagId] = useState("");
  const [published, setPublished] = useState("");
  const [editor, setEditor] = useState<Editor>(null);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: resourcesKey }),
      queryClient.invalidateQueries({ queryKey: tagsKey }),
      queryClient.invalidateQueries({ queryKey: fitGuideKey }),
    ]);
  const saved = () => {
    setEditor(null);
    void refresh();
  };
  const reorder = useMutation({
    mutationFn: ({
      collection,
      ids,
    }: {
      collection: "resources" | "resource-tags";
      ids: string[];
    }) => sendJson(`/api/admin/${collection}/reorder`, "PUT", { ids }),
    onSuccess: refresh,
  });

  if (resources.isPending || tags.isPending) {
    return <p role="status">Loading resources and tags…</p>;
  }
  if (!resources.data || !tags.data) {
    return (
      <div className="space-y-3">
        <p role="alert">Resources and tags could not be loaded.</p>
        <Button
          variant="outline"
          onClick={() => {
            void resources.refetch();
            void tags.refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  const visible = resources.data.filter(
    (resource) =>
      (!tagId || resource.tags.some((tag) => tag.id === tagId)) &&
      (!published || String(resource.is_published) === published),
  );

  return (
    <div className="space-y-4">
      {(resources.isError || tags.isError) && (
        <div className="space-y-2">
          <p role="alert">The latest resources and tags could not be loaded.</p>
          <Button variant="outline" onClick={() => void refresh()}>
            Try again
          </Button>
        </div>
      )}
      <Tabs defaultValue="resources">
        <TabsList aria-label="Resource management">
          <TabsTrigger value="resources">Resources</TabsTrigger>
          <TabsTrigger value="tags">Tags</TabsTrigger>
        </TabsList>
        <TabsContent value="resources" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap gap-3">
              <div className="space-y-1">
                <Label htmlFor={`${id}-tag`}>Filter by tag</Label>
                <select
                  id={`${id}-tag`}
                  className={selectClass}
                  value={tagId}
                  onChange={(event) => setTagId(event.target.value)}
                >
                  <option value="">All tags</option>
                  {tags.data.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${id}-published`}>Publication status</Label>
                <select
                  id={`${id}-published`}
                  className={selectClass}
                  value={published}
                  onChange={(event) => setPublished(event.target.value)}
                >
                  <option value="">All resources</option>
                  <option value="true">Published</option>
                  <option value="false">Draft</option>
                </select>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={resources.data.length < 2 || reorder.isPending}
                onClick={() => {
                  reorder.reset();
                  setEditor({ kind: "reorder-resources" });
                }}
              >
                Reorder resources
              </Button>
              <Button
                disabled={reorder.isPending}
                onClick={() => setEditor({ kind: "resource" })}
              >
                New resource
              </Button>
            </div>
          </div>
          {visible.length === 0 ? (
            <p>No resources match these filters.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((resource) => (
                  <TableRow key={resource.id}>
                    <TableCell className="max-w-72 font-medium break-words whitespace-normal">
                      {resource.name}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {resource.tags.length
                          ? resource.tags.map((tag) => (
                              <Badge key={tag.id} variant="outline">
                                {tag.name}
                              </Badge>
                            ))
                          : "No tags"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {resource.is_unc && (
                          <Badge variant="secondary">UNC</Badge>
                        )}
                        {resource.is_crisis && (
                          <Badge variant="destructive">Crisis</Badge>
                        )}
                        {!resource.is_unc && !resource.is_crisis && "—"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={resource.is_published ? "default" : "outline"}
                      >
                        {resource.is_published ? "Published" : "Draft"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          className="min-h-11"
                          aria-label={`Edit ${resource.name}`}
                          disabled={reorder.isPending}
                          onClick={() =>
                            setEditor({ kind: "resource", resource })
                          }
                        >
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          className="min-h-11"
                          aria-label={`Delete ${resource.name}`}
                          disabled={reorder.isPending}
                          onClick={() =>
                            setEditor({ kind: "delete-resource", resource })
                          }
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>
        <TabsContent value="tags" className="space-y-4">
          <Button
            disabled={reorder.isPending}
            onClick={() => setEditor({ kind: "tag" })}
          >
            New tag
          </Button>
          {tags.data.length === 0 ? (
            <p>No tags yet. Create a tag to organize resources.</p>
          ) : (
            <SortableList
              items={tags.data}
              getId={(tag) => tag.id}
              getLabel={(tag) => tag.name}
              disabled={reorder.isPending || tags.isFetching}
              onReorder={(ids) =>
                reorder.mutate({ collection: "resource-tags", ids })
              }
              renderItem={(tag) => (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium break-words">{tag.name}</span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="min-h-11"
                      aria-label={`Rename ${tag.name}`}
                      disabled={reorder.isPending}
                      onClick={() => setEditor({ kind: "tag", tag })}
                    >
                      Rename
                    </Button>
                    <Button
                      variant="outline"
                      className="min-h-11"
                      aria-label={`Delete ${tag.name}`}
                      disabled={reorder.isPending}
                      onClick={() => setEditor({ kind: "delete-tag", tag })}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              )}
            />
          )}
          {reorder.isError && <p role="alert">{errorMessage(reorder.error)}</p>}
        </TabsContent>
      </Tabs>
      {editor?.kind === "resource" && (
        <ResourceDialog
          resource={editor.resource}
          tags={tags.data}
          displayOrder={nextOrder(resources.data)}
          onClose={() => setEditor(null)}
          onSaved={saved}
        />
      )}
      {editor?.kind === "tag" && (
        <TagDialog
          tag={editor.tag}
          displayOrder={nextOrder(tags.data)}
          onClose={() => setEditor(null)}
          onSaved={saved}
        />
      )}
      {editor?.kind === "delete-resource" && (
        <DeleteResourceDialog
          resource={editor.resource}
          onClose={() => setEditor(null)}
          onDeleted={saved}
        />
      )}
      {editor?.kind === "delete-tag" && (
        <DeleteTagDialog
          tag={editor.tag}
          onClose={() => setEditor(null)}
          onDeleted={() => {
            if (tagId === editor.tag.id) setTagId("");
            saved();
          }}
        />
      )}
      {editor?.kind === "reorder-resources" && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !reorder.isPending) setEditor(null);
          }}
        >
          <DialogContent
            className="max-h-[85dvh] overflow-y-auto sm:max-w-xl"
            showCloseButton={!reorder.isPending}
          >
            <DialogHeader>
              <DialogTitle>Reorder resources</DialogTitle>
              <DialogDescription>
                Move resources up or down to save their order. This list
                includes all resources, regardless of the current filters.
              </DialogDescription>
            </DialogHeader>
            <SortableList
              items={resources.data}
              getId={(resource) => resource.id}
              getLabel={(resource) => resource.name}
              disabled={reorder.isPending || resources.isFetching}
              onReorder={(ids) =>
                reorder.mutate({ collection: "resources", ids })
              }
            />
            {reorder.isError && (
              <p role="alert">{errorMessage(reorder.error)}</p>
            )}
            <DialogFooter>
              <Button
                disabled={reorder.isPending}
                onClick={() => setEditor(null)}
              >
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function ResourceDialog({
  resource,
  tags,
  displayOrder,
  onClose,
  onSaved,
}: {
  resource?: AdminResource;
  tags: AdminResourceTag[];
  displayOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(resource?.name ?? "");
  const [description, setDescription] = useState(resource?.description ?? "");
  const [url, setUrl] = useState(resource?.url ?? "");
  const [phone, setPhone] = useState(resource?.phone ?? "");
  const [isUnc, setIsUnc] = useState(resource?.is_unc ?? false);
  const [isCrisis, setIsCrisis] = useState(resource?.is_crisis ?? false);
  const [isPublished, setIsPublished] = useState(
    resource?.is_published ?? false,
  );
  const [tagIds, setTagIds] = useState(
    resource?.tags.map((tag) => tag.id) ?? [],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (body: unknown) =>
      sendJson(
        resource
          ? `/api/admin/resources/${resource.id}`
          : "/api/admin/resources",
        resource ? "PATCH" : "POST",
        body,
      ),
    onSuccess: onSaved,
    onError: (error) => {
      if (error instanceof ApiError && error.status === 422) {
        const field = error.detail.split(":")[0];
        if (["name", "description", "url", "phone"].includes(field))
          setErrors({ [field]: error.detail });
      }
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (save.isPending) return;
    const invalid: Record<string, string> = {};
    if (!name.trim()) invalid.name = "Enter a resource name.";
    if (!description.trim()) invalid.description = "Enter a description.";
    if (url.trim()) {
      try {
        if (!/^https?:\/\//.test(url.trim())) throw new Error();
        new URL(url.trim());
      } catch {
        invalid.url = "Enter a valid URL starting with http:// or https://.";
      }
    }
    if (!url.trim() && !phone.trim())
      invalid.phone = "Enter a URL or phone number.";
    setErrors(invalid);
    if (Object.keys(invalid).length) return;
    save.mutate({
      name: name.trim(),
      description: description.trim(),
      url: url.trim() || null,
      phone: phone.trim() || null,
      is_unc: isUnc,
      is_crisis: isCrisis,
      is_published: isPublished,
      tag_ids: tagIds,
      ...(!resource && { display_order: displayOrder }),
    });
  }

  const fieldError = (field: string) =>
    errors[field] && (
      <p
        id={`${id}-${field}-error`}
        role="alert"
        className="text-sm text-destructive"
      >
        {errors[field]}
      </p>
    );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent
        className="max-h-[85dvh] overflow-y-auto sm:max-w-xl"
        showCloseButton={!save.isPending}
      >
        <DialogHeader>
          <DialogTitle>
            {resource ? "Edit resource" : "New resource"}
          </DialogTitle>
          <DialogDescription>
            Provide a URL or phone number. Only published resources appear on
            the public site.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={submit}
          aria-busy={save.isPending}
          className="space-y-4"
        >
          <fieldset disabled={save.isPending} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor={`${id}-name`}>Name</Label>
              <Input
                id={`${id}-name`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={200}
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? `${id}-name-error` : undefined}
              />
              {fieldError("name")}
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-description`}>Description</Label>
              <Textarea
                id={`${id}-description`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                required
                maxLength={1000}
                aria-invalid={!!errors.description}
                aria-describedby={
                  errors.description ? `${id}-description-error` : undefined
                }
              />
              {fieldError("description")}
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-url`}>URL</Label>
              <Input
                id={`${id}-url`}
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                maxLength={500}
                aria-invalid={!!errors.url}
                aria-describedby={errors.url ? `${id}-url-error` : undefined}
              />
              {fieldError("url")}
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-phone`}>Phone</Label>
              <Input
                id={`${id}-phone`}
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                maxLength={50}
                aria-invalid={!!errors.phone}
                aria-describedby={
                  errors.phone ? `${id}-phone-error` : undefined
                }
              />
              {fieldError("phone")}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Label className="min-h-11" htmlFor={`${id}-unc`}>
                <Checkbox
                  id={`${id}-unc`}
                  checked={isUnc}
                  onCheckedChange={(checked) => setIsUnc(checked === true)}
                />
                UNC resource
              </Label>
              <Label className="min-h-11" htmlFor={`${id}-crisis`}>
                <Checkbox
                  id={`${id}-crisis`}
                  checked={isCrisis}
                  onCheckedChange={(checked) => setIsCrisis(checked === true)}
                />
                Crisis resource
              </Label>
              <Label className="min-h-11" htmlFor={`${id}-published`}>
                <Checkbox
                  id={`${id}-published`}
                  checked={isPublished}
                  onCheckedChange={(checked) =>
                    setIsPublished(checked === true)
                  }
                />
                Published
              </Label>
            </div>
            {(isCrisis || resource?.is_crisis) && (
              <p
                role="note"
                className="rounded-lg border border-destructive/30 p-3"
              >
                Unpublishing a crisis resource removes it from the footer on
                every public page, site-wide.
              </p>
            )}
            <fieldset className="space-y-2">
              <legend className="font-medium">Tags</legend>
              {tags.length === 0 && (
                <p className="text-muted-foreground">
                  Create tags in the Tags tab to organize resources.
                </p>
              )}
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {tags.map((tag) => (
                  <Label
                    key={tag.id}
                    className="min-h-11"
                    htmlFor={`${id}-${tag.id}`}
                  >
                    <Checkbox
                      id={`${id}-${tag.id}`}
                      checked={tagIds.includes(tag.id)}
                      onCheckedChange={(checked) =>
                        setTagIds((current) =>
                          checked === true
                            ? [...current, tag.id]
                            : current.filter((value) => value !== tag.id),
                        )
                      }
                    />
                    {tag.name}
                  </Label>
                ))}
              </div>
            </fieldset>
          </fieldset>
          {save.isError && <p role="alert">{errorMessage(save.error)}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending
                ? "Saving…"
                : resource
                  ? "Save changes"
                  : "Create resource"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TagDialog({
  tag,
  displayOrder,
  onClose,
  onSaved,
}: {
  tag?: AdminResourceTag;
  displayOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(tag?.name ?? "");
  const save = useMutation({
    mutationFn: () =>
      sendJson(
        tag ? `/api/admin/resource-tags/${tag.id}` : "/api/admin/resource-tags",
        tag ? "PATCH" : "POST",
        { name: name.trim(), ...(!tag && { display_order: displayOrder }) },
      ),
    onSuccess: onSaved,
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent showCloseButton={!save.isPending}>
        <DialogHeader>
          <DialogTitle>{tag ? "Rename tag" : "New tag"}</DialogTitle>
          <DialogDescription>
            Tags help visitors filter resources. Renaming a tag updates it on
            every resource that uses it.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && !save.isPending) save.mutate();
          }}
          className="space-y-4"
          aria-busy={save.isPending}
        >
          <div className="space-y-1">
            <Label htmlFor={id}>Name</Label>
            <Input
              id={id}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={100}
              disabled={save.isPending}
            />
          </div>
          {save.isError && <p role="alert">{errorMessage(save.error)}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending || !name.trim()}>
              {save.isPending ? "Saving…" : tag ? "Save changes" : "Create tag"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type DeleteProps = { onClose: () => void; onDeleted: () => void };

function DeleteConfirmation({
  title,
  description,
  children,
  path,
  disabled,
  onClose,
  onDeleted,
}: DeleteProps & {
  title: string;
  description: string;
  children: ReactNode;
  path: string;
  disabled: boolean;
}) {
  const deletion = useMutation({
    mutationFn: () => apiFetch<void>(path, { method: "DELETE" }),
    onSuccess: onDeleted,
  });
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !deletion.isPending) onClose();
      }}
    >
      <AlertDialogContent className="max-h-[85dvh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        {deletion.isError && <p role="alert">{errorMessage(deletion.error)}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deletion.isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={disabled || deletion.isPending}
            onClick={(event) => {
              event.preventDefault();
              if (!disabled && !deletion.isPending) deletion.mutate();
            }}
          >
            {deletion.isPending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteResourceDialog({
  resource,
  ...props
}: DeleteProps & { resource: AdminResource }) {
  const guide = useQuery({
    queryKey: fitGuideKey,
    queryFn: () => apiFetch<FitGuideLink[]>("/api/admin/fit-guide"),
  });
  const affected =
    guide.data?.filter((item) => item.resource_id === resource.id) ?? [];
  return (
    <DeleteConfirmation
      {...props}
      title={`Delete “${resource.name}”?`}
      description="This resource will be permanently deleted. Fit-guide items stay in place; their links to this resource are cleared."
      path={`/api/admin/resources/${resource.id}`}
      disabled={guide.isFetching || guide.isPending || guide.isError}
    >
      {guide.isFetching || guide.isPending ? (
        <p role="status">Checking fit-guide links…</p>
      ) : guide.isError ? (
        <div className="space-y-2">
          <p role="alert">Fit-guide links could not be checked.</p>
          <Button variant="outline" onClick={() => guide.refetch()}>
            Try again
          </Button>
        </div>
      ) : affected.length ? (
        <div className="space-y-2">
          <p>Affected fit-guide items:</p>
          <ul className="list-disc space-y-1 pl-5">
            {affected.map((item) => (
              <li key={item.id}>{item.text}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p>No fit-guide items link to this resource.</p>
      )}
      {resource.is_crisis && resource.is_published && (
        <p>
          Deleting this crisis resource also removes it from the footer
          site-wide.
        </p>
      )}
    </DeleteConfirmation>
  );
}

function DeleteTagDialog({
  tag,
  ...props
}: DeleteProps & { tag: AdminResourceTag }) {
  // Refetch on opening so the count includes all resources, including drafts and filtered rows.
  const resources = useResources();
  const count =
    resources.data?.filter((resource) =>
      resource.tags.some((item) => item.id === tag.id),
    ).length ?? 0;
  return (
    <DeleteConfirmation
      {...props}
      title={`Delete “${tag.name}”?`}
      description="Deleting this tag removes it from every resource that uses it. The resources themselves are kept."
      path={`/api/admin/resource-tags/${tag.id}`}
      disabled={
        resources.isFetching || resources.isPending || resources.isError
      }
    >
      {resources.isFetching || resources.isPending ? (
        <p role="status">Checking tag usage…</p>
      ) : resources.isError ? (
        <div className="space-y-2">
          <p role="alert">Tag usage could not be checked.</p>
          <Button variant="outline" onClick={() => resources.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <p>
          {count} {count === 1 ? "resource uses" : "resources use"} this tag.
        </p>
      )}
    </DeleteConfirmation>
  );
}
