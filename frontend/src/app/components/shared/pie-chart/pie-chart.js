/* Copyright (C) 2016 NooBaa */

import template from './pie-chart.html';
import ko from 'knockout';
import {  makeArray, deepFreeze, decimalRound, sumBy } from 'utils/core-utils';
import { hexToRgb } from 'utils/color-utils';
import { getFormatter } from 'utils/chart-utils';
import style from 'style';

const { PI, max, pow, sqrt, atan2, cos, sin } = Math;
const PI2 = 2 * PI;

const defaultRadius = 84;
const defaultLineWidth = 20;

const baseAngle = PI / 1.3;
const separator = (2 * PI) / 1000;
const threshold = 2 * separator;
const defaultSilhouetteColor = style['color1'];
const changeResilience = 3;

const sumTextStyle = deepFreeze({
    font: `${style['font-family1']}` ,
    size: parseInt(style['font-size5']),
    weight: style['font-thin'],
    color: style['color6'],
    lineHeight: 1.2
});

const sumLabelTextStyle = deepFreeze({
    font: style['font-family1'],
    size: parseInt(style['font-size2']),
    weight: style['font-regular'],
    color: style['color7']
});

const tooltipPresets = deepFreeze([
    {
        angle: 1/8 * PI2,
        position: 'after'
    },
    {
        angle: 3/8 * PI2,
        position: 'below'
    },
    {
        angle: 5/8 * PI2,
        position: 'before'
    },
    {
        angle: 7/8 * PI2,
        position: 'above'
    },
    {
        angle: PI2,
        position: 'after'
    }
]);


function _normalizeValues(values) {
    const sum = sumBy(values);
    const thresholdSize = threshold * sum;
    const { delta, overhead } = values.reduce(
        ({ delta = 0, overhead = 0 }, value) => {
            if (value > 0){
                value < thresholdSize ?
                    delta += thresholdSize - value :
                    overhead += value - thresholdSize;
            }

            return { delta, overhead };
        },
        {}
    );

    let reminder = 0;
    return values.map(
        (value, i) => {
            if (value === 0) {
                return 0;
            }

            if (value <= thresholdSize) {
                return threshold;
            }

            const ratio = (value - (value - thresholdSize) * delta / overhead) / sum;
            if (i < values.length - 1) {
                const rounded = decimalRound(ratio, changeResilience);
                reminder += ratio - rounded;
                return rounded;
            } else {
                return decimalRound(ratio + reminder, changeResilience);
            }
        }
    );
}

function _breakTextToLines(ctx, text = '', style, maxWidth) {
    if (!text) return [];

    ctx.save();
    ctx.font = `${style.weight} ${style.size}px ${style.font}`;

    const [first, ...rest] = text.split(' ');
    const lines = rest.reduce(
        (lines, word) => {
            const line = `${lines[lines.length - 1]} ${word}`;
            if (ctx.measureText(line).width <= maxWidth) {
                lines[lines.length - 1] = line;
            } else {
                lines.push(word);
            }
            return lines;
        },
        [first]
    );

    ctx.restore();
    return lines;
}

function _prepareText(ctx, sum, sumLabel) {
    const valueLine = {
        text: sum,
        style: sumTextStyle
    };

    const labelLines = _breakTextToLines(ctx, sumLabel, sumLabelTextStyle, 100)
        .map(text => {
            const style = sumLabelTextStyle;
            return { text, style };
        });

    return [valueLine, ...labelLines];
}

class PieChartViewModel {
    constructor({
        values = [],
        sumLabel = '',
        format,
        radius = defaultRadius,
        lineWidth = defaultLineWidth,
        silhouetteColor = defaultSilhouetteColor,
        enableHover = true,
        showSum = true,
        showValues = true
    }) {
        this.radius = radius;
        this.lineWidth = lineWidth;
        this.silhouetteColor = silhouetteColor;
        this.enableHover = enableHover;

        const diameter = ko.pureComputed(
            () => ko.unwrap(radius) * 2
        );

        this.canvasParams = {
            width: diameter,
            height: diameter,
            draw: this.onDraw.bind(this)
        };

        this.mouseLocation = ko.observable(-1);

        this.hoveredIndex = ko.pureComputed(
            () => {
                let prev = 0;
                const mouse = this.mouseLocation();
                return this.values.findIndex(ratio  => {
                    const next = prev + ratio();
                    const hovered = prev <= mouse && mouse <= next;
                    prev = next;
                    return hovered;
                });
            }
        );

        const formatValue = getFormatter(format);

        this.primaryText = ko.pureComputed(
            () => {
                const i = this.hoveredIndex();
                if (i > -1) {
                    return ko.unwrap(showValues) ?
                        formatValue(ko.unwrap(values[i].value)) :
                        '';

                } else {
                    if (ko.unwrap(showSum)) {
                        const sum = sumBy(values, entry => ko.unwrap(entry.value));
                        return formatValue(sum);
                    } else {
                        return '';
                    }
                }
            }
        );

        this.secondaryText = ko.pureComputed(
            () => {
                const i = this.hoveredIndex();
                if (i > -1) {
                    return ko.unwrap(showValues) ?
                        ko.unwrap(values[i].label):
                        '';
                } else {
                    return ko.unwrap(showSum) ?
                        ko.unwrap(sumLabel):
                        '';
                }
            }
        );

        this.colors = ko.pureComputed(
            () => values.map(
                entry => entry.color
            )
        );

        this.total = ko.pureComputed(() =>
            values.reduce(
                (sum, entry) => sum + ko.unwrap(entry.value),
                0
            )
        );

        const normalized = ko.pureComputed(() =>
            _normalizeValues(
                values.map(entry => ko.unwrap(entry.value))
            )
        );

        const tooltips = ko.pureComputed(() => {
            const r = ko.unwrap(radius);
            let offset = 0;
            return normalized().map((ratio, i) => {
                const { tooltip, label, value } = ko.unwrap(values[i]);
                const angle = (baseAngle + (offset + (ratio / 2)) * PI2) % PI2;
                const coords = [r * (1 + cos(angle)), r * (1 + sin(angle))];
                const { position } = tooltipPresets.find(preset => angle < preset.angle);
                const text = tooltip ?
                    ko.unwrap(tooltip) :
                    `${ko.unwrap(label)}: ${ko.unwrap(value)}`;

                offset += ratio;
                return { coords, position, text };
            });
        });

        this.values = makeArray(
            values.length,
            i => ko.pureComputed(
                () => normalized()[i]
            ).extend({
                tween: {
                    resetOnChange: true,
                    resetValue: 0
                }
            })
        );


        this.tooltip = ko.pureComputed(() => {
            const index = this.hoveredIndex();
            return index === -1 ? null : tooltips()[index];
        });
    }

    onDraw(ctx) {
        const radius = ko.unwrap(this.radius);
        ctx.translate(radius, radius);

        this.drawGraph(ctx, this.hoveredIndex());

        if (this.primaryText() || this.secondaryText()) {
            this.drawText(
                ctx,
                _prepareText(ctx, this.primaryText(), this.secondaryText())
            );
        }
    }

    drawGraph(ctx, hoveredIndex) {
        ctx.save();

        ctx.rotate(baseAngle);
        this.drawArc(ctx, 0, 1, ko.unwrap(this.silhouetteColor));

        const colors = this.colors();
        const hasSeparator = this.values.filter(value => value() > 0).length > 1;
        this.values.reduce(
            (offset, ratio, i) => {
                const len = hasSeparator ? max(ratio() - separator, 0): ratio();
                if (len > 0) {
                    this.drawArc(ctx, offset, offset + len, colors[i], hoveredIndex == i );
                }
                return offset + ratio();
            },
            0
        );

        ctx.restore();
    }

    drawArc(ctx, start, end, color, isHovered) {
        const radius = ko.unwrap(this.radius);
        const lineWidth = ko.unwrap(this.lineWidth);
        const r = radius - (lineWidth / 2 | 0);
        const sAngle = start * 2  * PI;
        const eAngle = end * 2 * PI;

        ctx.lineWidth = lineWidth + (isHovered ? 0 : -4);
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(0, 0, r, sAngle, eAngle);
        ctx.stroke();
        ctx.closePath();

        if (isHovered) {
            ctx.lineWidth = 2;
            ctx.strokeStyle = hexToRgb(color, .5);
            ctx.beginPath();
            ctx.arc(0, 0, r - 15, sAngle, eAngle);
            ctx.stroke();
            ctx.closePath();
        }

    }

    drawText(ctx, lines) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        const height = sumBy(
            lines,
            line => {
                const { size, lineHeight = 1} = line.style;
                return size * lineHeight;
            }
        );
        let y = height / -2;

        for (const { text, style } of lines) {
            this.drawTextLine(ctx, text, style, y);
            y += style.size * (style.lineHeight || 1);
        }

        ctx.restore();
    }

    drawTextLine(ctx, text, style, y) {
        const { font, size, weight, color } = style;
        ctx.fillStyle = color;
        ctx.font = `${weight} ${size}px ${font}`;
        ctx.fillText(text, 0, y);
    }

    onMouse(_, evt) {
        if (!ko.unwrap(this.enableHover)) return;

        const radius = ko.unwrap(this.radius);
        const lineWidth = ko.unwrap(this.lineWidth);
        const x = evt.offsetX - radius;
        const y = evt.offsetY - radius;
        const len = sqrt(pow(x, 2) + pow(y, 2));

        if (radius - lineWidth <= len && len <= radius) {
            const rad = (atan2(y, x) + PI2 - baseAngle) % PI2;
            this.mouseLocation(rad / PI2);

        } else {
            this.mouseLocation(-1);
        }

        return true;
    }

    onMouseLeave() {
        if (!ko.unwrap(this.enableHover)) return;
        this.mouseLocation(-1);

        return true;
    }
}

export default {
    viewModel: PieChartViewModel,
    template: template
};
