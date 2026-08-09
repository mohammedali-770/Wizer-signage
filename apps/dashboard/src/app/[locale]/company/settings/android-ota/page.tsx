'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { AlertTriangle, ArrowLeft, Search, ShieldCheck, X } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  Input,
  Label,
  PageHeader,
  Spinner,
  useToast,
} from '@/components/ui';

interface AndroidOtaPolicyView {
  enabled: boolean;
  policyRevision: string | null;
  targetVersionName: string | null;
  targetVersionCode: number | null;
  rolloutPercent: number;
  screenIds: string[];
  groupIds: string[];
  checkIntervalSeconds: number;
}

interface CompanySettingsView {
  androidOta: AndroidOtaPolicyView;
}

interface Candidate {
  id: string;
  name: string;
}

interface PaginatedCandidates<T> {
  items: T[];
}

function useDebounced(value: string, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

export default function AndroidOtaSettingsPage() {
  const locale = useLocale();
  const ar = locale.toLowerCase().startsWith('ar');
  const { toast } = useToast();
  const settings = useApiResource<CompanySettingsView>('/company-settings');

  const text = ar
    ? {
        title: 'تحديث مشغل Android',
        description: 'تحكم تدريجي وآمن في تحديث أجهزة Wizer Signage.',
        back: 'إعدادات الشركة',
        release: 'الإصدار المسموح',
        versionName: 'اسم الإصدار',
        versionCode: 'رقم الإصدار',
        enabled: 'تفعيل التحديثات الجديدة',
        enabledHint: 'إيقاف هذا الخيار يوقف بدء محاولات تثبيت جديدة بعد جلب السياسة التالية.',
        rollout: 'نسبة التوزيع',
        cadence: 'فترة التحقق بالدقائق',
        canaries: 'الأجهزة التجريبية',
        screens: 'شاشات محددة',
        groups: 'مجموعات محددة',
        searchScreens: 'ابحث عن شاشة…',
        searchGroups: 'ابحث عن مجموعة…',
        noResults: 'لا توجد نتائج.',
        save: 'حفظ سياسة التحديث',
        halt: 'إيقاف التوزيع فوراً',
        saving: 'جاري الحفظ…',
        saved: 'تم حفظ سياسة التحديث.',
        failed: 'تعذر حفظ سياسة التحديث.',
        invalid: 'أدخل اسم إصدار ورقم إصدار موجب قبل تفعيل التحديث.',
        revision: 'مراجعة السياسة الحالية',
        noRevision: 'لم يتم حفظ سياسة تحديث بعد.',
        retryWarning:
          'كل حفظ ينشئ مراجعة سياسة جديدة. إذا كان جهاز BLOCKED أو FAILED نهائياً، فإن حفظ السياسة بعد معالجة السبب يسمح بمحاولة واحدة جديدة لذلك الجهاز.',
        rolloutWarning:
          'ابدأ بشاشات تجريبية ونسبة 0%. راقب الأعطال وحالة الاتصال بعد التثبيت، ثم ارفع النسبة تدريجياً. latest.json لا يغيّر الأجهزة تلقائياً.',
        exactWarning:
          'يجب أن يطابق اسم ورقم الإصدار ملف manifest ثابتاً منشوراً. لا تستخدم إصداراً أقدم؛ الرجوع يتم ببناء نسخة سليمة برقم versionCode أعلى.',
      }
    : {
        title: 'Android player updates',
        description: 'Safely control staged Wizer Signage player updates.',
        back: 'Company settings',
        release: 'Authorized release',
        versionName: 'Version name',
        versionCode: 'Version code',
        enabled: 'Enable new update attempts',
        enabledHint: 'Turning this off stops new install attempts after a device fetches the policy again.',
        rollout: 'Rollout percentage',
        cadence: 'Check interval (minutes)',
        canaries: 'Canary devices',
        screens: 'Explicit screens',
        groups: 'Explicit groups',
        searchScreens: 'Search screens…',
        searchGroups: 'Search groups…',
        noResults: 'No results.',
        save: 'Save rollout policy',
        halt: 'Halt rollout now',
        saving: 'Saving…',
        saved: 'Android rollout policy saved.',
        failed: 'Could not save Android rollout policy.',
        invalid: 'Enter a version name and positive version code before enabling updates.',
        revision: 'Current policy revision',
        noRevision: 'No rollout policy has been saved yet.',
        retryWarning:
          'Every save creates a new policy revision. After you remediate a terminal BLOCKED/FAILED device, saving the policy is the explicit one-attempt retry authorization.',
        rolloutWarning:
          'Start with explicit canaries and 0%. Watch crash/offline health after installation, then increase percentage deliberately. latest.json never advances devices by itself.',
        exactWarning:
          'Version name and code must identify one published immutable manifest. Never downgrade versionCode; rollback is a known-good build published under a higher code.',
      };

  const [initialized, setInitialized] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [versionName, setVersionName] = useState('');
  const [versionCode, setVersionCode] = useState('');
  const [rolloutPercent, setRolloutPercent] = useState('0');
  const [checkMinutes, setCheckMinutes] = useState('360');
  const [screenIds, setScreenIds] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [screenSearch, setScreenSearch] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const debouncedScreenSearch = useDebounced(screenSearch);
  const debouncedGroupSearch = useDebounced(groupSearch);

  const screens = useApiResource<PaginatedCandidates<{ id: string; name: string }>>(
    `/screens?page=1&pageSize=50${debouncedScreenSearch.trim() ? `&search=${encodeURIComponent(debouncedScreenSearch.trim())}` : ''}`,
  );
  const groups = useApiResource<PaginatedCandidates<{ id: string; name: string }>>(
    `/screen-groups?page=1&pageSize=50${debouncedGroupSearch.trim() ? `&search=${encodeURIComponent(debouncedGroupSearch.trim())}` : ''}`,
  );

  useEffect(() => {
    if (initialized || !settings.data?.androidOta) return;
    const policy = settings.data.androidOta;
    setEnabled(policy.enabled);
    setVersionName(policy.targetVersionName ?? '');
    setVersionCode(policy.targetVersionCode == null ? '' : String(policy.targetVersionCode));
    setRolloutPercent(String(policy.rolloutPercent ?? 0));
    setCheckMinutes(String(Math.max(15, Math.round((policy.checkIntervalSeconds ?? 21_600) / 60))));
    setScreenIds(policy.screenIds ?? []);
    setGroupIds(policy.groupIds ?? []);
    setInitialized(true);
  }, [initialized, settings.data]);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const item of screens.data?.items ?? []) next[item.id] = item.name;
    for (const item of groups.data?.items ?? []) next[item.id] = item.name;
    if (Object.keys(next).length > 0) {
      setLabels((current) => ({ ...current, ...next }));
    }
  }, [groups.data, screens.data]);

  const selectedScreenSet = useMemo(() => new Set(screenIds), [screenIds]);
  const selectedGroupSet = useMemo(() => new Set(groupIds), [groupIds]);

  const toggle = (id: string, kind: 'screen' | 'group') => {
    if (kind === 'screen') {
      setScreenIds((current) =>
        current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
      );
    } else {
      setGroupIds((current) =>
        current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
      );
    }
  };

  const save = async (forceEnabled = enabled) => {
    const code = Number(versionCode);
    const percent = Math.max(0, Math.min(100, Math.trunc(Number(rolloutPercent) || 0)));
    const minutes = Math.max(15, Math.min(1440, Math.trunc(Number(checkMinutes) || 360)));
    if (forceEnabled && (!versionName.trim() || !Number.isInteger(code) || code <= 0)) {
      toast(text.invalid, 'error');
      return;
    }

    setSaving(true);
    try {
      const updated = await api.put<CompanySettingsView>('/company-settings/android-ota', {
        enabled: forceEnabled,
        ...(versionName.trim() ? { targetVersionName: versionName.trim() } : {}),
        ...(Number.isInteger(code) && code > 0 ? { targetVersionCode: code } : {}),
        rolloutPercent: percent,
        screenIds,
        groupIds,
        checkIntervalSeconds: minutes * 60,
      });
      setEnabled(updated.androidOta.enabled);
      setRolloutPercent(String(updated.androidOta.rolloutPercent));
      setCheckMinutes(String(Math.round(updated.androidOta.checkIntervalSeconds / 60)));
      settings.reload();
      toast(text.saved, 'success');
    } catch (error) {
      toast(error instanceof ApiError ? error.message : text.failed, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (settings.loading && !settings.data) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="text-primary size-6" />
      </div>
    );
  }
  if (settings.error && !settings.data) {
    return <EmptyState title={text.title} description={settings.error} />;
  }

  const revision = settings.data?.androidOta.policyRevision;

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/company/settings"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> {text.back}
      </Link>
      <PageHeader title={text.title} description={text.description} />

      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>{text.release}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="accent-primary mt-1 size-4"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                disabled={saving}
              />
              <span>
                <span className="block text-sm font-medium">{text.enabled}</span>
                <span className="text-muted-foreground block text-xs">{text.enabledHint}</span>
              </span>
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={text.versionName}>
                <Input
                  value={versionName}
                  onChange={(event) => setVersionName(event.target.value)}
                  placeholder="1.4.2"
                  disabled={saving}
                />
              </Field>
              <Field label={text.versionCode}>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={versionCode}
                  onChange={(event) => setVersionCode(event.target.value)}
                  placeholder="42"
                  disabled={saving}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={text.rollout}>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={rolloutPercent}
                  onChange={(event) => setRolloutPercent(event.target.value)}
                  disabled={saving}
                />
              </Field>
              <Field label={text.cadence}>
                <Input
                  type="number"
                  min={15}
                  max={1440}
                  step={1}
                  value={checkMinutes}
                  onChange={(event) => setCheckMinutes(event.target.value)}
                  disabled={saving}
                />
              </Field>
            </div>

            <div className="border-border bg-muted/30 rounded-lg border p-3 text-xs">
              <div className="flex items-start gap-2">
                <ShieldCheck className="text-primary mt-0.5 size-4 shrink-0" />
                <p>{text.exactWarning}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{text.canaries}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 lg:grid-cols-2">
            <CandidatePicker
              title={text.screens}
              searchPlaceholder={text.searchScreens}
              emptyText={text.noResults}
              search={screenSearch}
              onSearch={setScreenSearch}
              loading={screens.loading}
              candidates={screens.data?.items ?? []}
              selected={screenIds}
              selectedSet={selectedScreenSet}
              labels={labels}
              onToggle={(id) => toggle(id, 'screen')}
              disabled={saving}
            />
            <CandidatePicker
              title={text.groups}
              searchPlaceholder={text.searchGroups}
              emptyText={text.noResults}
              search={groupSearch}
              onSearch={setGroupSearch}
              loading={groups.loading}
              candidates={groups.data?.items ?? []}
              selected={groupIds}
              selectedSet={selectedGroupSet}
              labels={labels}
              onToggle={(id) => toggle(id, 'group')}
              disabled={saving}
            />
          </CardContent>
        </Card>

        <Card className="p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div className="space-y-2 text-sm">
              <p>{text.rolloutWarning}</p>
              <p>{text.retryWarning}</p>
              <p className="text-muted-foreground text-xs">
                {text.revision}: {revision ?? text.noRevision}
              </p>
            </div>
          </div>
        </Card>

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="danger"
            disabled={saving || (!enabled && !settings.data?.androidOta.enabled)}
            onClick={() => save(false)}
          >
            {text.halt}
          </Button>
          <Button disabled={saving} onClick={() => save(enabled)}>
            {saving && <Spinner className="size-4" />}
            {saving ? text.saving : text.save}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CandidatePicker({
  title,
  searchPlaceholder,
  emptyText,
  search,
  onSearch,
  loading,
  candidates,
  selected,
  selectedSet,
  labels,
  onToggle,
  disabled,
}: {
  title: string;
  searchPlaceholder: string;
  emptyText: string;
  search: string;
  onSearch: (value: string) => void;
  loading: boolean;
  candidates: Candidate[];
  selected: string[];
  selectedSet: Set<string>;
  labels: Record<string, string>;
  onToggle: (id: string) => void;
  disabled: boolean;
}) {
  return (
    <section className="min-w-0">
      <Label>{title}</Label>
      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onToggle(id)}
              disabled={disabled}
              className="focus-visible:ring-primary/40 rounded-full focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50"
              title={id}
            >
              <Badge tone="info">
                {labels[id] ?? shortId(id)} <X aria-hidden className="ms-1 inline size-3" />
              </Badge>
            </button>
          ))}
        </div>
      )}
      <div className="relative mb-2">
        <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" />
        <Input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={searchPlaceholder}
          className="ps-9"
          disabled={disabled}
        />
      </div>
      {loading && candidates.length === 0 ? (
        <div className="flex justify-center py-6">
          <Spinner className="text-primary size-5" />
        </div>
      ) : candidates.length === 0 ? (
        <p className="text-muted-foreground py-3 text-sm">{emptyText}</p>
      ) : (
        <ul className="divide-border border-border max-h-64 divide-y overflow-y-auto rounded-md border">
          {candidates.map((item) => (
            <li key={item.id}>
              <label className="hover:bg-muted flex cursor-pointer items-center gap-3 px-3 py-2 transition">
                <input
                  type="checkbox"
                  className="accent-primary size-4"
                  checked={selectedSet.has(item.id)}
                  disabled={disabled}
                  onChange={() => onToggle(item.id)}
                />
                <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
