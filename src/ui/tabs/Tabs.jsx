import cn from 'classnames';

export default function Tabs({ centered, pills, color, children, ...props }) {
    return (
        <div
            className={cn('tabs', {
                'tabs--centered': centered,
                'tabs--pills': pills,
                [`tabs--${color}`]: color
            })}
            {...props}
        >
            <div className="tabs__nav">
                {children}
            </div>
        </div>
    );
}