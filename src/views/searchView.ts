'use strict';
import { commands, ConfigurationChangeEvent } from 'vscode';
import { configuration, SearchViewConfig, ViewFilesLayout, ViewsConfig } from '../configuration';
import { CommandContext, GlyphChars, setCommandContext, WorkspaceState } from '../constants';
import { Container } from '../container';
import { GitLog, GitRepoSearchBy } from '../git/gitService';
import { Functions, Strings } from '../system';
import { ResourceType, ResultsCommitsNode, SearchNode, ViewNode } from './nodes';
import { RefreshReason, ViewBase } from './viewBase';

interface SearchQueryResult {
    label: string;
    log: GitLog | undefined;
}

export class SearchView extends ViewBase<SearchNode> {
    constructor() {
        super('gitlens.views.search');

        setCommandContext(CommandContext.ViewsSearchKeepResults, this.keepResults);
    }

    getRoot() {
        return new SearchNode(this);
    }

    protected get location(): string {
        return this.config.location;
    }

    protected registerCommands() {
        void Container.viewCommands;
        commands.registerCommand(this.getQualifiedCommand('clear'), () => this.clear(), this);
        commands.registerCommand(this.getQualifiedCommand('refresh'), () => this.refresh(), this);
        commands.registerCommand(
            this.getQualifiedCommand('setFilesLayoutToAuto'),
            () => this.setFilesLayout(ViewFilesLayout.Auto),
            this
        );
        commands.registerCommand(
            this.getQualifiedCommand('setFilesLayoutToList'),
            () => this.setFilesLayout(ViewFilesLayout.List),
            this
        );
        commands.registerCommand(
            this.getQualifiedCommand('setFilesLayoutToTree'),
            () => this.setFilesLayout(ViewFilesLayout.Tree),
            this
        );
        commands.registerCommand(this.getQualifiedCommand('setKeepResultsToOn'), () => this.setKeepResults(true), this);
        commands.registerCommand(
            this.getQualifiedCommand('setKeepResultsToOff'),
            () => this.setKeepResults(false),
            this
        );
    }

    protected onConfigurationChanged(e: ConfigurationChangeEvent) {
        if (
            !configuration.changed(e, configuration.name('views')('search').value) &&
            !configuration.changed(e, configuration.name('views').value) &&
            !configuration.changed(e, configuration.name('defaultGravatarsStyle').value)
        ) {
            return;
        }

        if (configuration.changed(e, configuration.name('views')('search')('location').value)) {
            this.initialize(this.config.location /*, { showCollapseAll: true } */);
        }

        if (!configuration.initializing(e) && this._root !== undefined) {
            void this.refresh(RefreshReason.ConfigurationChanged);
        }
    }

    get config(): ViewsConfig & SearchViewConfig {
        return { ...Container.config.views, ...Container.config.views.search };
    }

    get keepResults(): boolean {
        return Container.context.workspaceState.get<boolean>(WorkspaceState.ViewsSearchKeepResults, false);
    }

    clear() {
        if (this._root === undefined) return;

        this._root.clear();
    }

    dismissNode(node: ViewNode) {
        if (this._root === undefined) return;

        this._root.dismiss(node);
    }

    async search(
        repoPath: string,
        search: string,
        searchBy: GitRepoSearchBy,
        options: {
            maxCount?: number;
            label:
                | string
                | {
                      label: string;
                      resultsType?: { singular: string; plural: string };
                  };
        }
    ) {
        await this.show();

        const searchQueryFn = this.getSearchQueryFn(
            repoPath,
            Container.git.getLogForSearch(repoPath, search, searchBy, {
                maxCount: options.maxCount
            }),
            options
        );

        return this.addResults(
            new ResultsCommitsNode(this, this._root!, repoPath, searchQueryFn, ResourceType.SearchResults)
        );
    }

    async showSearchResults(
        repoPath: string,
        results: GitLog,
        options: {
            label:
                | string
                | {
                      label: string;
                      resultsType?: { singular: string; plural: string };
                  };
        }
    ) {
        const label = await this.getSearchLabel(repoPath, options.label, results);
        const searchQueryFn = Functions.cachedOnce(this.getSearchQueryFn(repoPath, results, options), {
            label: label,
            log: results
        });

        return this.addResults(
            new ResultsCommitsNode(this, this._root!, repoPath, searchQueryFn, ResourceType.SearchResults)
        );
    }

    private async addResults(results: ViewNode) {
        const root = this.ensureRoot();
        root.addOrReplace(results, !this.keepResults);

        setImmediate(() => this.reveal(results, { select: true, expand: true }));
    }

    private async getSearchLabel(
        repoPath: string,
        label:
            | string
            | {
                  label: string;
                  resultsType?: { singular: string; plural: string };
              },
        log: GitLog | undefined
    ) {
        if (typeof label === 'string') return label;

        const count = log !== undefined ? log.count : 0;
        const truncated = log !== undefined ? log.truncated : false;

        const resultsType =
            label.resultsType === undefined ? { singular: 'result', plural: 'results' } : label.resultsType;

        let repository = '';
        if ((await Container.git.getRepositoryCount()) > 1) {
            const repo = await Container.git.getRepository(repoPath);
            repository = ` ${Strings.pad(GlyphChars.Dash, 1, 1)} ${(repo && repo.formattedName) || repoPath}`;
        }

        return `${Strings.pluralize(resultsType.singular, count, {
            number: truncated ? `${count}+` : undefined,
            plural: resultsType.plural,
            zero: 'No'
        })} for ${label.label}${repository}`;
    }

    private getSearchQueryFn(
        repoPath: string,
        results: Promise<GitLog | undefined> | GitLog | undefined,
        options: {
            label:
                | string
                | {
                      label: string;
                      resultsType?: { singular: string; plural: string };
                  };
        }
    ): (maxCount: number | undefined) => Promise<SearchQueryResult> {
        return async (maxCount: number | undefined) => {
            if (Functions.isPromise(results)) {
                results = await results;
            }

            let log;
            if (results !== undefined) {
                log = await (results.query === undefined
                    ? (maxCount: number | undefined) => Promise.resolve(results)
                    : results.query)(maxCount);
            }

            const label = await this.getSearchLabel(repoPath, options.label, log);
            return {
                label: label,
                log: log
            };
        };
    }

    private setFilesLayout(layout: ViewFilesLayout) {
        return configuration.updateEffective(configuration.name('views')('search')('files')('layout').value, layout);
    }

    private setKeepResults(enabled: boolean) {
        Container.context.workspaceState.update(WorkspaceState.ViewsSearchKeepResults, enabled);
        setCommandContext(CommandContext.ViewsSearchKeepResults, enabled);
    }
}
