import ko from 'knockout';
import { action$ } from 'state';
import { openShowVideoModal, selectHelpTopic } from 'action-creators';

export default class TopicRowViewModel {
    constructor(onClose) {
        this.topic = ko.observable();
        this.icon = ko.observable();
        this.close = onClose;
    }

    onTopic(topic) {
        this.topic(topic);
        this.icon(topic.kind.toLowerCase());
    }

    onSelect() {
        this.close();
        const { uri, kind, title } = this.topic();
        if (kind === 'LINK') {
            window.open(uri,'_newtab');
        } else if (kind === 'VIDEO') {
            action$.onNext(openShowVideoModal(title, uri));
        } else {
            action$.onNext(selectHelpTopic(this.topic()));
        }
    }
}
