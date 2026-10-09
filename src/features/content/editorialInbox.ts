import type { EditorialState, EditorialJob } from './model';

export interface EditorialInboxItem {
  id: string; workspaceId: string; topicId: string; contentId?: string;
  artifactId?: string; artifactVersion?: number;
  kind: 'research-needed' | 'research-review' | 'research-error' | 'script-needed' | 'script-review' | 'script-error' | 'notion-error' | 'video-review'|'publication-review';
  title: string; detail?: string; updatedAt: string; urgency: 'blocked' | 'review' | 'next';
}

/** Reflect current records instead of keeping a second queue of approval decisions. */
export function editorialInbox(state: EditorialState, jobs: readonly EditorialJob[], workspaceId: string): EditorialInboxItem[] {
  const items: EditorialInboxItem[] = [];
  for (const topic of state.topics.filter(item => item.workspaceId === workspaceId)) {
    const artifact = state.artifacts.find(item => item.id === topic.researchArtifactId && item.topicId === topic.id && item.workspaceId === workspaceId);
    const kind = topic.status === 'error' ? 'research-error' : topic.status === 'draft' ? 'research-needed' : topic.status === 'review' && artifact ? 'research-review' : null;
    if (kind) items.push({ id: `${kind}:${topic.id}:${artifact?.id ?? ''}`, workspaceId, topicId: topic.id, artifactId: artifact?.id, artifactVersion: artifact?.version, kind, title: topic.title, detail: topic.lastError, updatedAt: topic.updatedAt, urgency: kind === 'research-error' ? 'blocked' : kind === 'research-review' ? 'review' : 'next' });
  }
  for (const content of state.contents.filter(item => item.workspaceId === workspaceId && item.productionStage !== 'archived')) {
    const artifact = state.artifacts.find(item => item.id === content.scriptOptionsArtifactId && item.contentId === content.id && item.workspaceId === workspaceId);
    const review=state.approvals.find(item=>item.artifactId===artifact?.id&&item.action==='script-review');
    const kind = content.status === 'error' ? 'script-error' : content.status === 'planning'&&!['editing','video-review','ready'].includes(content.productionStage??'')||content.status==='script-rejected'||content.status==='script-review'&&review?.decision==='revision-requested' ? 'script-needed' : content.status === 'script-review' && artifact ? 'script-review' : content.productionStage === 'video-review' ? 'video-review' : null;
    if (kind) items.push({ id: `${kind}:${content.id}:${artifact?.id ?? ''}`, workspaceId, topicId: content.topicId, contentId: content.id, artifactId: artifact?.id, artifactVersion: artifact?.version, kind, title: content.title, detail: content.lastError??(kind==='script-needed'?review?.notes:undefined), updatedAt: content.updatedAt, urgency: kind === 'script-error' ? 'blocked' : kind === 'script-needed' ? 'next' : 'review' });
    const job = jobs.filter(item => item.contentId === content.id && item.artifactId === content.approvedScriptArtifactId).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (job?.status === 'failed') items.push({ id: `notion-error:${job.id}`, workspaceId, topicId: content.topicId, contentId: content.id, artifactId: job.artifactId, kind: 'notion-error', title: content.title, detail: job.error, updatedAt: job.updatedAt, urgency: 'blocked' });
    for(const delivery of state.publications??[])if(delivery.contentId===content.id&&delivery.workspaceId===workspaceId&&delivery.status==='in-review')items.push({id:`publication-review:${delivery.id}:${delivery.version}`,workspaceId,topicId:content.topicId,contentId:content.id,artifactVersion:delivery.version,kind:'publication-review',title:`${content.title} · ${delivery.platform}`,updatedAt:delivery.updatedAt,urgency:'review'});
  }
  const rank = { blocked: 0, review: 1, next: 2 };
  return items.sort((a,b) => rank[a.urgency] - rank[b.urgency] || b.updatedAt.localeCompare(a.updatedAt));
}
