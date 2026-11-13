import type { ReactNode } from "react";
import { useCollection } from "@cloudscape-design/collection-hooks";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Header from "@cloudscape-design/components/header";
import Pagination from "@cloudscape-design/components/pagination";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table, { type TableProps } from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";
import { CLI_PROFILE, REGIONS, getRegion } from "../config";

/** The list page table used all over the console: header, counter, filter, pagination, refresh. */
export function ResourceTable<T>({
  title,
  description,
  info,
  items,
  loading,
  error,
  columns,
  trackBy,
  selectionType,
  selected = [],
  onSelect,
  isItemDisabled,
  actions,
  onRefresh,
  filterPlaceholder,
  resourceName,
  emptyAction,
  pageSize = 20,
  variant = "full-page",
  stickyHeader = true,
  wrapLines,
  extraFilter,
  emptyDescription,
  emptyCli,
  global,
}: {
  title: string;
  description?: ReactNode;
  info?: ReactNode;
  items: T[] | undefined;
  loading: boolean;
  error?: string;
  columns: TableProps.ColumnDefinition<T>[];
  trackBy: (item: T) => string;
  selectionType?: "single" | "multi";
  selected?: T[];
  onSelect?: (items: T[]) => void;
  isItemDisabled?: (item: T) => boolean;
  actions?: ReactNode;
  onRefresh?: () => void;
  filterPlaceholder?: string;
  resourceName: string;
  emptyAction?: ReactNode;
  pageSize?: number;
  variant?: TableProps.Variant;
  stickyHeader?: boolean;
  wrapLines?: boolean;
  extraFilter?: ReactNode;
  /** Extra line in the empty state, such as what the resource is for. */
  emptyDescription?: ReactNode;
  /** CLI arguments that create the resource, shown in the empty state. */
  emptyCli?: string;
  /** True for resources that are not tied to a Region, such as S3 buckets. */
  global?: boolean;
}) {
  const region = getRegion();
  const regionLabel = REGIONS.find((r) => r.id === region)?.label ?? region;
  const all = items ?? [];
  const { items: visible, collectionProps, filterProps, paginationProps, filteredItemsCount } = useCollection(all, {
    filtering: {
      empty: (
        <Box textAlign="center" color="inherit" margin={{ vertical: "l" }}>
          <SpaceBetween size="m">
            <div>
              <b>No {resourceName}</b>
              <Box variant="p" color="inherit">
                {global ? `You don't have any ${resourceName}.` : `You don't have any ${resourceName} in ${regionLabel} (${region}).`}
              </Box>
              {emptyDescription && (
                <Box variant="p" color="text-body-secondary">
                  {emptyDescription}
                </Box>
              )}
            </div>
            {emptyAction}
            {emptyCli && (
              <Box color="text-body-secondary" fontSize="body-s">
                Or use the CLI: <Box variant="code">aws --profile {CLI_PROFILE} {emptyCli}</Box>
              </Box>
            )}
          </SpaceBetween>
        </Box>
      ),
      noMatch: (
        <Box textAlign="center" color="inherit" margin={{ vertical: "l" }}>
          <b>No matches</b>
          <Box variant="p" color="inherit">
            We can't find a match.
          </Box>
        </Box>
      ),
    },
    pagination: { pageSize },
    sorting: {},
  });

  const counter = selected.length ? `(${selected.length}/${all.length})` : `(${all.length})`;

  return (
    <Table
      {...collectionProps}
      variant={variant}
      stickyHeader={stickyHeader}
      wrapLines={wrapLines}
      resizableColumns
      enableKeyboardNavigation
      items={visible}
      columnDefinitions={columns}
      trackBy={trackBy}
      loading={loading && !items}
      loadingText={`Loading ${resourceName}`}
      selectionType={selectionType}
      selectedItems={selected}
      onSelectionChange={(e) => onSelect?.(e.detail.selectedItems)}
      isItemDisabled={isItemDisabled}
      header={
        <SpaceBetween size="s">
          <Header
            variant={variant === "full-page" ? "awsui-h1-sticky" : "h2"}
            counter={items ? counter : undefined}
            description={description}
            info={info}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                {onRefresh && <Button iconName="refresh" ariaLabel="Refresh" loading={loading && !!items} onClick={onRefresh} />}
                {actions}
              </SpaceBetween>
            }
          >
            {title}
          </Header>
          {error && (
            <Alert type="error" header={`Could not load ${resourceName}`}>
              {error}
            </Alert>
          )}
        </SpaceBetween>
      }
      filter={
        <SpaceBetween direction="horizontal" size="s">
          <div style={{ minWidth: 320 }}>
            <TextFilter
              {...filterProps}
              filteringPlaceholder={filterPlaceholder ?? `Find ${resourceName}`}
              countText={`${filteredItemsCount} ${filteredItemsCount === 1 ? "match" : "matches"}`}
            />
          </div>
          {extraFilter}
        </SpaceBetween>
      }
      pagination={<Pagination {...paginationProps} />}
    />
  );
}
