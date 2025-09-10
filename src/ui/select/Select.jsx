import { useEffect, useRef, useState } from 'react';
import cn from 'classnames';

export default function Select({
    label,
    name,
    value,
    options,
    defaultValue,
    onChange
}) {
    const rootRef = useRef(null);
    const inputRef = useRef(null);

    const [internalValue, setInternalValue] = useState(defaultValue);
    const [active, setActive] = useState(false);

    const isControlled = value !== undefined && onChange !== undefined;

    useEffect(() => {
        function handleClickOutside(event) {
            if (rootRef.current && !rootRef.current.contains(event.target)) {
                setActive(false);
            }
        }

        document.addEventListener('click', handleClickOutside, true);

        return () => {
            document.removeEventListener('click', handleClickOutside, true);
        };
    });

    const handleClick = (e) => {
        const selectedValue = e.currentTarget.dataset.value;

        if (selectedValue !== value) {
            const selectEvent = new Event('change', { bubbles: true });
            const input = inputRef.current;

            if (input) {
                input.value = selectedValue;
                input.dispatchEvent(selectEvent);
                onChange?.(selectEvent);
            }

            if (!isControlled) {
                setInternalValue(selectedValue);
            }
        }

        setActive(false);
    };

    const selectedOption = options
        ? options.find(option => option.value === (isControlled ? value : internalValue))
        : null;

    return (
        <div
            ref={rootRef}
            className={cn('select', { 'select--active': active })}
        >
            <input
                ref={inputRef}
                className="select__input"
                type="hidden"
                name={name}
                value={value}
                defaultValue={defaultValue}
                onChange={onChange}
            />

            <label className="select__label">
                {label}
            </label>

            <button className="select__button" type="button" onClick={() => setActive(!active)}>
                {selectedOption &&
                    <span className="select__value">{selectedOption.label}</span>
                }

                <span className="select__arrow">
                    <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M1 6.28442L5.56875 1.71567L10.1375 6.28442" stroke="#262626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"></path>
                    </svg>
                </span>
            </button>

            <ul className="select__list">
                {options?.map(option => (
                    <li
                        key={option.value}
                        className="select__option"
                        data-value={option.value}
                        onClick={handleClick}
                    >
                        {option.label}
                    </li>
                ))}
            </ul>
        </div>
    );
}