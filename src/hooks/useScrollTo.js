import { useCallback, useRef } from 'react';

const defaultOptions = {
    behavior: 'smooth',
    block: 'center'
};

export default function useScrollTo(selector, options = {}) {
    const optionsRef = useRef(options);

    const scrollTo = useCallback((event) => {
        event.preventDefault();

        const scrollTo = event.currentTarget.dataset.scrollTo || selector;
        const element = document.querySelector(scrollTo);

        if (element) {
            element.scrollIntoView({
                ...defaultOptions,
                ...optionsRef.current
            });
        }
    }, []);

    return scrollTo;
}