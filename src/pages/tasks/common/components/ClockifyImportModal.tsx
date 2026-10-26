/**
 * Invoice Ninja (https://invoiceninja.com).
 *
 * @link https://github.com/invoiceninja/invoiceninja source repository
 *
 * @copyright Copyright (c) 2026. Invoice Ninja LLC (https://invoiceninja.com)
 *
 * @license https://www.elastic.co/licensing/elastic-license
 */

import { AxiosError } from 'axios';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { useColorScheme } from '$app/common/colors';
import { endpoint } from '$app/common/helpers';
import { request } from '$app/common/helpers/request';
import { toast } from '$app/common/helpers/toast/toast';
import { $refetch } from '$app/common/hooks/useRefetch';
import { Button, InputField } from '$app/components/forms';
import { Modal } from '$app/components/Modal';

interface ImportedRow {
  date: string;
  client: string;
  project: string | null;
  description: string;
  raw_hours: number;
  rounded_hours: number;
  task_number?: string | null;
}

interface SkippedRow extends ImportedRow {
  reason: string;
  detail: string;
  existing_task?: string;
}

interface ImportResult {
  created: ImportedRow[];
  skipped: SkippedRow[];
  totals: {
    created: number;
    skipped: number;
    non_billable_entries_ignored: number;
  };
  dry_run: boolean;
}

function lastCompleteWeek() {
  const thisMonday = dayjs().subtract((dayjs().day() + 6) % 7, 'day');
  const lastMonday = thisMonday.subtract(7, 'day');

  return {
    start: lastMonday.format('YYYY-MM-DD'),
    end: lastMonday.add(6, 'day').format('YYYY-MM-DD'),
  };
}

function isMidWeek(start: string, end: string) {
  return dayjs(start).day() !== 1 || dayjs(end).day() !== 0;
}

interface Props {
  visible: boolean;
  setVisible: (visible: boolean) => unknown;
}

export function ClockifyImportModal({ visible, setVisible }: Props) {
  const colors = useColorScheme();
  const defaults = lastCompleteWeek();

  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);
  const [isBusy, setIsBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');

  useEffect(() => {
    if (!visible) {
      return;
    }

    request('GET', endpoint('/api/v1/clockify/settings')).then((response) => {
      setHasKey(response.data.data.has_key);
      setWorkspaceId(response.data.data.workspace_id ?? '');
      setShowSettings(!response.data.data.has_key);
    });
  }, [visible]);

  const saveSettings = () => {
    setIsBusy(true);
    toast.processing();

    request('PUT', endpoint('/api/v1/clockify/settings'), {
      ...(apiKey ? { api_key: apiKey } : {}),
      workspace_id: workspaceId || null,
    })
      .then((response) => {
        setHasKey(response.data.data.has_key);
        setShowSettings(false);
        setApiKey('');
        toast.success();
      })
      .catch((error: AxiosError<{ message?: string }>) => {
        toast.dismiss();
        toast.error(error.response?.data?.message ?? 'error_title');
      })
      .finally(() => setIsBusy(false));
  };

  const run = (dryRun: boolean) => {
    setIsBusy(true);
    toast.processing();

    request('POST', endpoint('/api/v1/clockify/import'), {
      start,
      end,
      dry_run: dryRun,
    })
      .then((response) => {
        setResult(response.data.data);

        if (!dryRun) {
          $refetch(['tasks']);
        }

        toast.dismiss();
      })
      .catch((error: AxiosError<{ message?: string }>) => {
        toast.dismiss();
        toast.error(error.response?.data?.message ?? 'error_title');
      })
      .finally(() => setIsBusy(false));
  };

  const invalidRange = !start || !end || end < start;

  return (
    <Modal
      title="Import from Clockify"
      visible={visible}
      onClose={setVisible}
      size="large"
    >
      {showSettings ? (
        <div className="flex flex-col space-y-3">
          <InputField
            label="Clockify API key"
            type="password"
            value={apiKey}
            placeholder={hasKey ? 'Saved (enter a new key to replace it)' : ''}
            onValueChange={setApiKey}
          />

          <InputField
            label="Workspace ID (optional if you have one workspace)"
            value={workspaceId}
            onValueChange={setWorkspaceId}
          />

          <div className="flex space-x-2">
            <Button
              behavior="button"
              disabled={isBusy || (!hasKey && !apiKey)}
              disableWithoutIcon
              onClick={saveSettings}
            >
              Save
            </Button>

            {hasKey && (
              <Button
                type="secondary"
                behavior="button"
                onClick={() => setShowSettings(false)}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      ) : (
        <Button
          type="minimal"
          behavior="button"
          onClick={() => setShowSettings(true)}
        >
          Clockify settings
        </Button>
      )}

      <div className="flex space-x-4">
        <InputField
          label="Start"
          type="date"
          style={{ colorScheme: colors.$0 }}
          value={start}
          onValueChange={(value) => {
            setStart(value);
            setResult(null);
          }}
        />

        <InputField
          label="End"
          type="date"
          style={{ colorScheme: colors.$0 }}
          value={end}
          onValueChange={(value) => {
            setEnd(value);
            setResult(null);
          }}
        />
      </div>

      {!invalidRange && isMidWeek(start, end) && (
        <p className="text-sm" style={{ color: colors.$3 }}>
          This range does not start on a Monday and end on a Sunday. Hours are
          still rounded across the whole week, so each day matches a full-week
          import.
        </p>
      )}

      <div className="flex space-x-2">
        <Button
          type="secondary"
          behavior="button"
          disabled={isBusy || invalidRange || !hasKey}
          disableWithoutIcon
          onClick={() => run(true)}
        >
          Preview
        </Button>

        <Button
          behavior="button"
          disabled={isBusy || invalidRange || !result?.dry_run}
          disableWithoutIcon
          onClick={() => run(false)}
        >
          Import
        </Button>
      </div>

      {result && <ImportResults result={result} />}
    </Modal>
  );
}

function ImportResults({ result }: { result: ImportResult }) {
  const colors = useColorScheme();

  const row = (r: ImportedRow, extra?: string) =>
    `${r.date}  ${r.client}${r.project ? ` / ${r.project}` : ''}  "${
      r.description
    }"  ${r.raw_hours}h -> ${r.rounded_hours}h${extra ?? ''}`;

  return (
    <div
      className="flex flex-col space-y-4 text-sm max-h-96 overflow-y-auto"
      style={{ color: colors.$3 }}
    >
      <div className="font-medium">
        {result.dry_run ? 'Preview: ' : ''}
        {result.totals.created} {result.dry_run ? 'to add' : 'added'},{' '}
        {result.totals.skipped} skipped
        {result.totals.non_billable_entries_ignored > 0 &&
          `, ${result.totals.non_billable_entries_ignored} non-billable entries ignored`}
      </div>

      {result.created.length > 0 && (
        <div>
          <div className="font-medium">
            {result.dry_run ? 'Will be added' : 'Added'}
          </div>
          <ul className="font-mono text-xs space-y-1">
            {result.created.map((r, i) => (
              <li key={i}>
                {row(r, r.task_number ? `  (task ${r.task_number})` : '')}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.skipped.length > 0 && (
        <div>
          <div className="font-medium">Skipped</div>
          <ul className="font-mono text-xs space-y-1">
            {result.skipped.map((r, i) => (
              <li key={i}>
                {row(r)}
                <br />
                {`  ${r.reason}: ${r.detail}${
                  r.existing_task ? ` (task ${r.existing_task})` : ''
                }`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
