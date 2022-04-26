export const PROMOCODE = 'FAST20';

export const formats = [
    {
        id: 'offline',
        title: 'Оффлайн индивидуально',
        description: 'Выберите это обучение, если вы занимаетесь с преподавателем лично - у нас в школе, дома или в офисе',
        types: [
            {
                id: 'russian',
                description: 'Обучение с русскоязычным преподавателем',
                packs: [
                    { id: 1, description: '1 урок', price: 1900 },
                    { id: 2, description: '2 урока', price: 7000 },
                    { id: 8, description: '8 уроков', price: 12800 },
                    { id: 16, description: '16 уроков', price: 24800 }
                ]
            },
            {
                id: 'native',
                description: 'Обучение с носителем языка',
                packs: [
                    { id: 1, description: '1 урок', price: 2150 },
                    { id: 2, description: '2 урока', price: 7800 },
                    { id: 8, description: '8 уроков', price: 14400 },
                    { id: 16, description: '16 уроков', price: 27200 }
                ]
            },
            {
                id: 'prep',
                description: 'Подготовка к экзаменам, специальные курсы, бизнес-курс',
                packs: [
                    { id: 1, description: '1 урок', price: 2150 },
                    { id: 2, description: '2 урока', price: 7800 },
                    { id: 8, description: '8 уроков', price: 14400 },
                    { id: 16, description: '16 уроков', price: 27200 }
                ]
            }
        ]
    },
    {
        id: 'online',
        title: 'Онлайн индивидуально',
        description: 'Выберите это обучение, если вы занимаетесь дистанционно по Скайп',
        types: [
            {
                id: 'russian',
                description: 'Обучение с русскоязычным преподавателем',
                packs: [
                    { id: 5, description: '5 уроков', price: 5450 },
                    { id: 10, description: '10 уроков', price: 10300 },
                    { id: 20, description: '20 уроков', price: 19000 },
                    { id: 40, description: '40 уроков', price: 35600 },
                    { id: 60, description: '60 уроков', price: 48900 }
                ]
            },
            {
                id: 'native',
                description: 'Обучение с носителем языка',
                packs: [
                    { id: 5, description: '5 уроков', price: 7600 },
                    { id: 10, description: '10 уроков', price: 14100 },
                    { id: 20, description: '20 уроков', price: 27200 },
                    { id: 40, description: '40 уроков', price: 52000 },
                    { id: 60, description: '60 уроков', price: 72000 }
                ]
            },
            {
                id: 'children',
                description: 'Детское обучение с русскоязычным преподавателем (25 мин.)',
                packs: [
                    { id: 5, description: '5 уроков', price: 3500 },
                    { id: 10, description: '10 уроков', price: 6500 },
                    { id: 20, description: '20 уроков', price: 12000 },
                    { id: 40, description: '40 уроков', price: 22000 },
                    { id: 60, description: '60 уроков', price: 30000 }
                ]
            },
            {
                id: 'prep',
                description: 'Подготовка к экзаменам, специальные курсы, бизнес-курс',
                packs: [
                    { id: 5, description: '5 урока', price: 7600 },
                    { id: 10, description: '10 уроков', price: 14100 },
                    { id: 20, description: '20 уроков', price: 27200 },
                    { id: 40, description: '40 урока', price: 52000 }
                ]
            }
        ]
    },
    {
        id: 'online-group',
        title: 'Онлайн в группе',
        description: 'Выберите это обучение, если вы занимаетесь в группе по Zoom',
        packs: [
            { id: 1, description: '1 месяц обучения (8 занятий)', price: 10000 },
            { id: 2, description: '3 месяца обучения (24 занятий)', price: 26700 },
            { id: 3, description: '6 месяца обучения (48 занятия)', price: 43200 }
        ]
    }
];