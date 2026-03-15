/*!
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import { Box, Heading, useToken } from "@chakra-ui/react";
import {
  BarElement,
  Chart as ChartJS,
  CategoryScale,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import type { PartialEventContext } from "chartjs-plugin-annotation";
import annotationPlugin from "chartjs-plugin-annotation";
import dayjs from "dayjs";
import { Bar } from "react-chartjs-2";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import type { TaskInstanceResponse, GridRunsResponse } from "openapi/requests/types.gen";
import { useTimezone } from "src/context/timezone";
import { getComputedCSSVariableValue } from "src/theme";
import { DEFAULT_DATETIME_FORMAT, formatDate, renderDuration } from "src/utils/datetimeUtils";
import { buildTaskInstanceUrl } from "src/utils/links";

ChartJS.register(
  BarElement,
  CategoryScale,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  annotationPlugin,
);

type RunResponse = GridRunsResponse | TaskInstanceResponse;

type MkAnnotationArgs = {
  color: string;
  dash?: Array<number>;
  labelFn: (ctx: PartialEventContext) => string;
  valueFn: (ctx: PartialEventContext) => number;
};

const average = (ctx: PartialEventContext, index: number) => {
  const values = ctx.chart.data.datasets[index]?.data as Array<number> | undefined;

  return values === undefined ? 0 : values.reduce((acc, next) => acc + next, 0) / values.length;
};

const median = (ctx: PartialEventContext, index: number) => {
  const values = ctx.chart.data.datasets[index]?.data as Array<number> | undefined;

  if (!values) {
    return 0;
  }
  const sorted = [...values].sort((first, second) => first - second);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
};

const getDuration = (start: string, end: string | null) => {
  const startDate = dayjs(start);
  const endDate = end === null ? dayjs() : dayjs(end);

  if (!startDate.isValid() || !endDate.isValid()) {
    return 0;
  }

  return dayjs.duration(endDate.diff(startDate)).asSeconds();
};

const getTickLabelFormat = (entries: Array<RunResponse>): string => {
  if (entries.length < 2) {
    return "HH:mm:ss";
  }
  const first = dayjs(entries[0]?.run_after);
  const last = dayjs(entries[entries.length - 1]?.run_after);

  if (!first.isValid() || !last.isValid()) {
    return "MMM DD";
  }

  return Math.abs(last.diff(first, "day")) < 1 ? "HH:mm:ss" : "MMM DD HH:mm";
};

const mkAnnotation = ({ color, dash, labelFn, valueFn }: MkAnnotationArgs) => ({
  borderColor: color,
  borderDash: dash,
  borderWidth: dash ? 2 : 1,
  label: { content: labelFn, display: true, position: "end" as const },
  scaleID: "y",
  value: valueFn,
});

export const DurationChart = ({
  entries,
  isAutoRefreshing = false,
  kind,
}: {
  readonly entries: Array<RunResponse> | undefined;
  readonly isAutoRefreshing?: boolean;
  readonly kind: "Dag Run" | "Task Instance";
}) => {
  const { t: translate } = useTranslation(["components", "common"]);
  const navigate = useNavigate();
  const { selectedTimezone } = useTimezone();
  const [queuedColorToken] = useToken("colors", ["queued.solid"]);
  const states = entries?.map((entry) => entry.state).filter(Boolean) ?? [];
  const stateColorTokens = useToken(
    "colors",
    states.map((state) => `${state}.solid`),
  );

  if (!entries) {
    return undefined;
  }

  const stateColorMap: Record<string, string> = {};

  states.forEach((state, index) => {
    if (state) {
      stateColorMap[state] = getComputedCSSVariableValue(stateColorTokens[index] ?? "oklch(0.5 0 0)");
    }
  });

  const runAnnotation = mkAnnotation({
    color: "grey",
    labelFn: (ctx) => renderDuration(average(ctx, 1), false) ?? "0",
    valueFn: (ctx) => average(ctx, 1),
  });
  const queuedAnnotation = mkAnnotation({
    color: "grey",
    labelFn: (ctx) => renderDuration(average(ctx, 0), false) ?? "0",
    valueFn: (ctx) => average(ctx, 0),
  });
  const medianAnnotation = mkAnnotation({
    color: "blue",
    dash: [6, 3],
    labelFn: (ctx) => `Median: ${renderDuration(median(ctx, 1), false) ?? "0"}`,
    valueFn: (ctx) => median(ctx, 1),
  });

  const getQueuedDuration = (entry: RunResponse) => {
    switch (kind) {
      case "Dag Run": {
        const run = entry as GridRunsResponse;

        return run.queued_at !== null && run.start_date !== null && run.queued_at < run.start_date
          ? Number(getDuration(run.queued_at, run.start_date))
          : 0;
      }
      case "Task Instance": {
        const ti = entry as TaskInstanceResponse;

        return ti.queued_when !== null && ti.start_date !== null && ti.queued_when < ti.start_date
          ? Number(getDuration(ti.queued_when, ti.start_date))
          : 0;
      }
      default:
        return 0;
    }
  };

  return (
    <Box w="100%">
      <Heading pb={2} size="sm" textAlign="center">
        {kind === "Dag Run"
          ? translate("durationChart.lastDagRun", { count: entries.length })
          : translate("durationChart.lastTaskInstance", { count: entries.length })}
      </Heading>
      <Box h="400px">
        <Bar
          data={{
            datasets: [
              {
                backgroundColor: getComputedCSSVariableValue(queuedColorToken ?? "oklch(0.5 0 0)"),
                data: entries.map((entry: RunResponse) => getQueuedDuration(entry)),
                label: translate("durationChart.queuedDuration"),
              },
              {
                backgroundColor: entries.map(
                  (entry: RunResponse) =>
                    (entry.state ? stateColorMap[entry.state] : undefined) ?? "oklch(0.5 0 0)",
                ),
                data: entries.map((entry: RunResponse) =>
                  entry.start_date === null ? 0 : Number(getDuration(entry.start_date, entry.end_date)),
                ),
                label: translate("durationChart.runDuration"),
              },
            ],
            labels: entries.map((entry: RunResponse) =>
              dayjs(entry.run_after).format(DEFAULT_DATETIME_FORMAT),
            ),
          }}
          datasetIdKey="id"
          options={{
            animation: isAutoRefreshing ? false : undefined,
            maintainAspectRatio: false,
            onClick: (_event, elements) => {
              const [element] = elements;
                return;
              }
              switch (kind) {
                  const entry = entries[element.index] as GridRunsResponse | undefined;

                  void Promise.resolve(navigate(`/dags/${entry?.dag_id}/runs/${entry?.run_id}`));
                }
                case "Task Instance": {
                  const entry = entries[element.index] as TaskInstanceResponse | undefined;

                  if (entry === undefined) {
                    return;
                  }
                  void Promise.resolve(
                    navigate(
                      buildTaskInstanceUrl({
                        currentPathname: location.pathname,
                        dagId: entry.dag_id,
                        isMapped: entry.map_index >= 0,
                        mapIndex: entry.map_index.toString(),
                        runId: entry.dag_run_id,
                        taskId: entry.task_id,
                      }),
                    ),
                  );
                  break;
                }
                default:
              }
            },
            onHover: (_event, elements, chart) => {
              chart.canvas.style.cursor = elements.length > 0 ? "pointer" : "default";
            },
            plugins: {
              annotation: { annotations: { medianAnnotation, queuedAnnotation, runAnnotation } },
              legend: { display: true, position: "top" as const },
              tooltip: {
                callbacks: {
                  label: (context) => {
                    const datasetLabel = context.dataset.label ?? "";
                    const formatted = renderDuration(context.parsed.y, false) ?? "0";

                    return datasetLabel ? `${datasetLabel}: ${formatted}` : formatted;
                  },
                },
              },
            },
            responsive: true,
            scales: {
              x: {
                stacked: true,
                ticks: {
                  callback: (_value, index) =>
                    formatDate(entries[index]?.run_after, selectedTimezone, getTickLabelFormat(entries)),
                  maxTicksLimit: 3,
                },
                title: { align: "end", display: true, text: translate("common:dagRun.runAfter") },
              },
              y: {
                stacked: true,
                ticks: {
                  callback: (value) =>
                    renderDuration(typeof value === "number" ? value : Number(value), false) ?? "0",
                },
                title: { align: "end", display: true, text: translate("common:duration") },
              },
            },
          }}
        />
      </Box>
    </Box>
  );
};
