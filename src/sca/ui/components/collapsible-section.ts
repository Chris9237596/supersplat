import { Container, Label } from '@playcanvas/pcui';

import { ScaSectionId, ScaSectionLayoutManager } from '../sca-section-layout-state';

type CollapsibleSectionOptions = {
    sectionId: ScaSectionId;
    title: string;
    layout: ScaSectionLayoutManager;
    class?: string;
};

class CollapsibleSection extends Container {
    readonly body: Container;

    private readonly sectionId: ScaSectionId;

    private readonly layout: ScaSectionLayoutManager;

    private readonly header: Container;

    private readonly marker: Label;

    private open: boolean;

    constructor(options: CollapsibleSectionOptions) {
        super({
            class: ['sca-collapsible-section', options.class].filter(Boolean)
        });

        this.sectionId = options.sectionId;
        this.layout = options.layout;
        this.open = this.layout.isOpen(options.sectionId);

        this.header = new Container({ class: 'sca-collapsible-section-header' });
        this.marker = new Label({ class: 'sca-collapsible-section-marker' });
        const title = new Label({
            class: 'sca-collapsible-section-title',
            text: options.title
        });

        this.header.append(this.marker);
        this.header.append(title);

        this.body = new Container({ class: 'sca-collapsible-section-body' });

        this.append(this.header);
        this.append(this.body);

        this.header.dom.addEventListener('click', () => {
            this.setOpen(this.layout.toggle(this.sectionId));
        });

        this.setOpen(this.open, false);
    }

    setOpen(open: boolean, persist = true): void {
        this.open = open;
        this.marker.text = open ? '\u25BC' : '\u25B6';
        this.body.hidden = !open;
        this.header.class.toggle('is-open', open);
        this.class.toggle('is-open', open);

        if (persist) {
            this.layout.setOpen(this.sectionId, open);
        }
    }
}

export { CollapsibleSection, CollapsibleSectionOptions };
