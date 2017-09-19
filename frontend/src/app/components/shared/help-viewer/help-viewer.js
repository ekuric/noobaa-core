/* Copyright (C) 2016 NooBaa */

import template from './help-viewer.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import ko from 'knockout';
import {
    closeHelpViewer,
    resizeHelpViewer,
    selectHelpSlide
} from 'action-creators';

class HelpViewerViewModel extends Observer {
    constructor() {
        super();

        this.visible = ko.observable();
        this.resizeIcon = ko.observable();
        this.title = ko.observable();
        this.topic = ko.observable();
        this.minimized = ko.observable();
        this.isShowDone = ko.observable();
        this.isShowPrvious = ko.observable();

        this.observe(state$.get('interactiveHelp'), this.onInteractiveHelp);
    }

    onInteractiveHelp(interactiveHelp) {
        const { selected } = interactiveHelp;
        if(!selected) {
            this.visible(false);
            this.topic(null);
            this.title('');
        } else {
            const { title, minimized, ...topic } = selected;
            const isLastSlide = (topic.kind === 'SLIDES') && (topic.slides && topic.slides.length === topic.slide + 1);

            this.title(title);
            this.topic(topic);
            this.minimized(minimized);
            this.resizeIcon(minimized ? 'minimize' : 'maximize');
            this.isShowDone(isLastSlide);
            this.isShowPrvious((topic.kind === 'SLIDES') && (topic.slide !== 0));
            this.visible(true);
        }
    }

    onClose() {
        action$.onNext(closeHelpViewer());
    }

    onResize() {
        action$.onNext(resizeHelpViewer());
    }

    onPrev() {
        action$.onNext(selectHelpSlide(this.slide - 1));
    }

    onNext() {
        action$.onNext(selectHelpSlide(this.slide + 1));
    }
}

export default {
    viewModel: HelpViewerViewModel,
    template: template
};
